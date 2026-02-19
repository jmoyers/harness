interface HandleLeftRailActionClickOptions {
  action: string | null;
  selectedProjectId: string | null;
  selectedRepositoryId: string | null;
  activeConversationId: string | null;
  repositoriesCollapsed: boolean;
  clearConversationTitleEditClickState: () => void;
  resolveDirectoryForAction: () => string | null;
  openNewThreadPrompt: (directoryId: string) => void;
  queueArchiveConversation: (conversationId: string) => void;
  openAddDirectoryPrompt: () => void;
  openRepositoryPromptForCreate: () => void;
  repositoryExists: (repositoryId: string) => boolean;
  openRepositoryPromptForEdit: (repositoryId: string) => void;
  queueArchiveRepository: (repositoryId: string) => void;
  toggleRepositoryGroup: (repositoryId: string) => void;
  selectLeftNavRepository: (repositoryId: string) => void;
  expandAllRepositoryGroups: () => void;
  collapseAllRepositoryGroups: () => void;
  enterHomePane: () => void;
  enterTasksPane?: () => void;
  queueCloseDirectory: (directoryId: string) => void;
  toggleShortcutsCollapsed: () => void;
  markDirty: () => void;
}

export function handleLeftRailActionClick(options: HandleLeftRailActionClickOptions): boolean {
  if (options.action === 'conversation.new') {
    options.clearConversationTitleEditClickState();
    const targetDirectoryId = options.selectedProjectId ?? options.resolveDirectoryForAction();
    if (targetDirectoryId !== null) {
      options.openNewThreadPrompt(targetDirectoryId);
    }
    options.markDirty();
    return true;
  }
  if (options.action === 'conversation.delete') {
    options.clearConversationTitleEditClickState();
    if (options.activeConversationId !== null) {
      options.queueArchiveConversation(options.activeConversationId);
    }
    options.markDirty();
    return true;
  }
  if (options.action === 'project.add') {
    options.clearConversationTitleEditClickState();
    options.openAddDirectoryPrompt();
    options.markDirty();
    return true;
  }
  if (options.action === 'repository.add') {
    options.clearConversationTitleEditClickState();
    options.openRepositoryPromptForCreate();
    return true;
  }
  if (options.action === 'repository.edit') {
    options.clearConversationTitleEditClickState();
    if (
      options.selectedRepositoryId !== null &&
      options.repositoryExists(options.selectedRepositoryId)
    ) {
      options.openRepositoryPromptForEdit(options.selectedRepositoryId);
    }
    options.markDirty();
    return true;
  }
  if (options.action === 'repository.archive') {
    options.clearConversationTitleEditClickState();
    if (
      options.selectedRepositoryId !== null &&
      options.repositoryExists(options.selectedRepositoryId)
    ) {
      options.queueArchiveRepository(options.selectedRepositoryId);
    }
    options.markDirty();
    return true;
  }
  if (options.action === 'repository.toggle') {
    options.clearConversationTitleEditClickState();
    if (options.selectedRepositoryId !== null) {
      options.toggleRepositoryGroup(options.selectedRepositoryId);
      options.selectLeftNavRepository(options.selectedRepositoryId);
    }
    options.markDirty();
    return true;
  }
  if (options.action === 'repositories.toggle') {
    options.clearConversationTitleEditClickState();
    if (options.repositoriesCollapsed) {
      options.expandAllRepositoryGroups();
    } else {
      options.collapseAllRepositoryGroups();
    }
    options.markDirty();
    return true;
  }
  if (options.action === 'home.open') {
    options.clearConversationTitleEditClickState();
    options.enterHomePane();
    options.markDirty();
    return true;
  }
  if (options.action === 'tasks.open') {
    options.clearConversationTitleEditClickState();
    if (options.enterTasksPane !== undefined) {
      options.enterTasksPane();
    } else {
      options.enterHomePane();
    }
    options.markDirty();
    return true;
  }
  if (options.action === 'project.close') {
    options.clearConversationTitleEditClickState();
    const targetDirectoryId = options.selectedProjectId ?? options.resolveDirectoryForAction();
    if (targetDirectoryId !== null) {
      options.queueCloseDirectory(targetDirectoryId);
    }
    options.markDirty();
    return true;
  }
  if (options.action === 'shortcuts.toggle') {
    options.clearConversationTitleEditClickState();
    options.toggleShortcutsCollapsed();
    options.markDirty();
    return true;
  }
  return false;
}
