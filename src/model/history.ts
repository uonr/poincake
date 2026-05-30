import { applyWorldPatch, type WorldPatch } from './commands';
import type { HyperbolicWorldState } from './worldState';

export type HistoryState = Readonly<{
  canUndo: boolean;
  canRedo: boolean;
}>;

export class WorldHistory {
  private readonly undoStack: WorldPatch[] = [];
  private readonly redoStack: WorldPatch[] = [];

  get state(): HistoryState {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    };
  }

  record(patch: WorldPatch): void {
    this.undoStack.push(patch);
    this.redoStack.length = 0;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  undo(world: HyperbolicWorldState): boolean {
    const patch = this.undoStack.pop();
    if (!patch) {
      return false;
    }

    applyWorldPatch(world, patch, 'backward');
    this.redoStack.push(patch);
    return true;
  }

  redo(world: HyperbolicWorldState): boolean {
    const patch = this.redoStack.pop();
    if (!patch) {
      return false;
    }

    applyWorldPatch(world, patch, 'forward');
    this.undoStack.push(patch);
    return true;
  }
}
