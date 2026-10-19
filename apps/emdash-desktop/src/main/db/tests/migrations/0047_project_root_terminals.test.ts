import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * 0047 makes terminals.task_id nullable and adds workspace_id so project-root terminals can
 * live in the same table without a task.
 */
describe('0047 project root terminals', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('baseline');
  });

  afterEach(() => {
    fixture?.close();
  });

  function firstTask(): { projectId: string; taskId: string } {
    return fixture.sqlite
      .prepare(`SELECT project_id AS projectId, id AS taskId FROM tasks LIMIT 1`)
      .get() as { projectId: string; taskId: string };
  }

  it('keeps task_id on task rows and adds the workspace_id column and index', () => {
    const { projectId, taskId } = firstTask();
    fixture.sqlite
      .prepare(`INSERT INTO terminals (id, project_id, task_id, name) VALUES (?, ?, ?, ?)`)
      .run('terminal-task', projectId, taskId, 'task shell');

    const row = fixture.sqlite
      .prepare(`SELECT task_id, workspace_id, shell_id FROM terminals WHERE id = ?`)
      .get('terminal-task');
    expect(row).toEqual({ task_id: taskId, workspace_id: null, shell_id: 'system' });

    const indexes = fixture.sqlite
      .prepare(`PRAGMA index_list('terminals')`)
      .all()
      .map((index) => (index as { name: string }).name);
    expect(indexes).toEqual(
      expect.arrayContaining(['idx_terminals_task_id', 'idx_terminals_workspace_id'])
    );
  });

  it('allows a null task_id and still cascades task and project deletes', () => {
    fixture.sqlite.pragma('foreign_keys = ON');
    const { projectId, taskId } = firstTask();
    fixture.sqlite
      .prepare(
        `INSERT INTO terminals (id, project_id, task_id, workspace_id, name) VALUES (?, ?, NULL, ?, ?)`
      )
      .run('terminal-root', projectId, 'workspace-root', 'root shell');
    fixture.sqlite
      .prepare(`INSERT INTO terminals (id, project_id, task_id, name) VALUES (?, ?, ?, ?)`)
      .run('terminal-task', projectId, taskId, 'task shell');

    fixture.sqlite.prepare(`DELETE FROM tasks WHERE id = ?`).run(taskId);
    const remaining = fixture.sqlite
      .prepare(`SELECT id FROM terminals WHERE id IN ('terminal-root', 'terminal-task')`)
      .all();
    expect(remaining).toEqual([{ id: 'terminal-root' }]);

    fixture.sqlite.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
    expect(
      fixture.sqlite.prepare(`SELECT id FROM terminals WHERE id = 'terminal-root'`).get()
    ).toBeUndefined();
  });
});
