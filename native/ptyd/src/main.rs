use libc::{c_char, c_int, pid_t};
use std::ffi::CString;
use std::io;
use std::os::fd::RawFd;
use std::process::ExitCode;
use std::{mem, ptr};

const OPCODE_DATA: u8 = 0x01;
const OPCODE_RESIZE: u8 = 0x02;
const OPCODE_CLOSE: u8 = 0x03;

fn errno_code() -> Option<i32> {
    io::Error::last_os_error().raw_os_error()
}

fn write_all_fd(fd: RawFd, mut buf: &[u8]) -> Result<(), ()> {
    while !buf.is_empty() {
        let written = unsafe { libc::write(fd, buf.as_ptr().cast(), buf.len()) };
        if written < 0 {
            if errno_code() == Some(libc::EINTR) {
                continue;
            }
            return Err(());
        }
        let w = written as usize;
        buf = &buf[w..];
    }
    Ok(())
}

fn signal_child(child_pid: pid_t, sig: c_int) {
    let pgid = unsafe { libc::getpgid(child_pid) };
    if pgid < 0 {
        return;
    }

    if pgid == child_pid {
        let _ = unsafe { libc::killpg(pgid, sig) };
    } else {
        let _ = unsafe { libc::kill(child_pid, sig) };
    }
}

fn parse_and_apply_frames(incoming: &mut Vec<u8>, master_fd: RawFd, child_pid: pid_t) -> Result<(), ()> {
    loop {
        if incoming.is_empty() {
            return Ok(());
        }

        match incoming[0] {
            OPCODE_DATA => {
                if incoming.len() < 5 {
                    return Ok(());
                }
                let n = u32::from_be_bytes([incoming[1], incoming[2], incoming[3], incoming[4]]) as usize;
                if incoming.len() < 5 + n {
                    return Ok(());
                }

                if n > 0 {
                    write_all_fd(master_fd, &incoming[5..5 + n])?;
                }
                incoming.drain(0..(5 + n));
            }
            OPCODE_RESIZE => {
                if incoming.len() < 5 {
                    return Ok(());
                }

                let cols = u16::from_be_bytes([incoming[1], incoming[2]]);
                let rows = u16::from_be_bytes([incoming[3], incoming[4]]);

                let mut ws: libc::winsize = unsafe { mem::zeroed() };
                ws.ws_col = cols;
                ws.ws_row = rows;
                let rc = unsafe { libc::ioctl(master_fd, libc::TIOCSWINSZ, &ws) };
                if rc < 0 {
                    return Err(());
                }

                signal_child(child_pid, libc::SIGWINCH);
                incoming.drain(0..5);
            }
            OPCODE_CLOSE => {
                signal_child(child_pid, libc::SIGHUP);
                incoming.drain(0..1);
            }
            _ => {
                incoming.drain(0..1);
            }
        }
    }
}

fn child_exit_code(status: c_int) -> i32 {
    if libc::WIFEXITED(status) {
        return libc::WEXITSTATUS(status);
    }
    if libc::WIFSIGNALED(status) {
        return 128 + libc::WTERMSIG(status);
    }
    1
}

fn run() -> i32 {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        return 2;
    }

    let cstrings: Vec<CString> = match args
        .iter()
        .map(|arg| CString::new(arg.as_str()))
        .collect::<Result<Vec<_>, _>>()
    {
        Ok(v) => v,
        Err(_) => return 2,
    };
    let mut argv: Vec<*const c_char> = cstrings.iter().map(|s| s.as_ptr()).collect();
    argv.push(ptr::null());

    let mut master_fd: c_int = 0;
    let mut slave_fd: c_int = 0;
    let open_rc = unsafe {
        libc::openpty(
            &mut master_fd,
            &mut slave_fd,
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
        )
    };
    if open_rc != 0 {
        return 1;
    }

    let pid = unsafe { libc::fork() };
    if pid < 0 {
        unsafe {
            libc::close(master_fd);
            libc::close(slave_fd);
        }
        return 1;
    }

    if pid == 0 {
        if unsafe { libc::setsid() } < 0 {
            unsafe { libc::_exit(1) };
        }

        if unsafe { libc::ioctl(slave_fd, libc::TIOCSCTTY as libc::c_ulong, 0) } < 0 {
            unsafe { libc::_exit(1) };
        }

        if unsafe { libc::dup2(slave_fd, libc::STDIN_FILENO) } < 0 {
            unsafe { libc::_exit(1) };
        }
        if unsafe { libc::dup2(slave_fd, libc::STDOUT_FILENO) } < 0 {
            unsafe { libc::_exit(1) };
        }
        if unsafe { libc::dup2(slave_fd, libc::STDERR_FILENO) } < 0 {
            unsafe { libc::_exit(1) };
        }

        unsafe {
            libc::close(master_fd);
            libc::close(slave_fd);
            libc::execvp(argv[0], argv.as_ptr());
            libc::_exit(127);
        }
    }

    unsafe {
        libc::close(slave_fd);
    }

    let mut incoming: Vec<u8> = Vec::with_capacity(8192);
    let mut io_buf = vec![0_u8; 65_536];
    let mut stdin_open = true;

    loop {
        let mut status: c_int = 0;
        let waited = unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) };
        if waited == pid {
            unsafe { libc::close(master_fd) };
            return child_exit_code(status);
        }

        let stdin_fd = if stdin_open { libc::STDIN_FILENO } else { -1 };
        let mut pfds = [
            libc::pollfd {
                fd: stdin_fd,
                events: libc::POLLIN,
                revents: 0,
            },
            libc::pollfd {
                fd: master_fd,
                events: libc::POLLIN,
                revents: 0,
            },
        ];

        let poll_rc = unsafe { libc::poll(pfds.as_mut_ptr(), pfds.len() as _, 100) };
        if poll_rc < 0 {
            if errno_code() == Some(libc::EINTR) {
                continue;
            }
            unsafe { libc::close(master_fd) };
            return 1;
        }

        if stdin_open && (pfds[0].revents & libc::POLLIN) != 0 {
            let n = unsafe { libc::read(libc::STDIN_FILENO, io_buf.as_mut_ptr().cast(), io_buf.len()) };
            if n == 0 {
                stdin_open = false;
            } else if n < 0 {
                if errno_code() != Some(libc::EINTR) {
                    stdin_open = false;
                }
            } else {
                let n_usize = n as usize;
                incoming.extend_from_slice(&io_buf[..n_usize]);
                if parse_and_apply_frames(&mut incoming, master_fd, pid).is_err() {
                    unsafe { libc::close(master_fd) };
                    return 1;
                }
            }
        }

        if (pfds[1].revents & libc::POLLIN) != 0 {
            let n = unsafe { libc::read(master_fd, io_buf.as_mut_ptr().cast(), io_buf.len()) };
            if n == 0 {
                let mut status2: c_int = 0;
                let _ = unsafe { libc::waitpid(pid, &mut status2, 0) };
                unsafe { libc::close(master_fd) };
                return child_exit_code(status2);
            }
            if n < 0 {
                if errno_code() == Some(libc::EINTR) {
                    continue;
                }
                unsafe { libc::close(master_fd) };
                return 1;
            }
            let n_usize = n as usize;
            if write_all_fd(libc::STDOUT_FILENO, &io_buf[..n_usize]).is_err() {
                unsafe { libc::close(master_fd) };
                return 1;
            }
        }
    }
}

fn main() -> ExitCode {
    let code = run();
    ExitCode::from((code & 0xFF) as u8)
}
