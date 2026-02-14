declare global {
  class Float16Array extends Uint16Array {
    constructor(length: number);
    constructor(array: ArrayLike<number>);
    constructor(buffer: ArrayBufferLike, byteOffset?: number, length?: number);
    static readonly BYTES_PER_ELEMENT: number;
  }
}

export {};
