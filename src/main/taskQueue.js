// Полноценная очередь задач для агентов: приоритеты, параллелизм, статусы,
// повторные попытки, сохранение между запусками, отмена.
// Задача может выполняться одним агентом или командой (swarm).
const { randomUUID } = require('crypto');
const EventEmitter = require('events');
const store = require('./store');

const TERMINAL = ['completed', 'failed', 'cancelled'];

class TaskQueue extends EventEmitter {
  constructor() {
    super();
    this.tasks = [];
    this.running = new Set(); // ids
    this.loaded = false;
    this.paused = false;
    this.timer = null; // для отложенных задач (runAt)
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;
    this.paused = !!store.get('taskQueuePaused', false);
    const saved = store.get('taskQueue', []);
    // Незавершённые задачи после перезапуска переводим обратно в очередь.
    this.tasks = (Array.isArray(saved) ? saved : []).map((t) => (
      t.status === 'running' ? { ...t, status: 'queued' } : t
    ));
  }

  maxConcurrent() { return Math.max(1, Math.min(5, parseInt(store.get('settings.taskConcurrency', 2), 10) || 2)); }

  list() { this.load(); return { paused: this.paused, tasks: this.tasks.map((t) => ({ ...t, result: t.result ? String(t.result).slice(0, 4000) : t.result })) }; }

  save() {
    // Храним всё активное + завершённое за последние 24 ч.
    const keep = this.tasks.filter((t) => !TERMINAL.includes(t.status) || (Date.now() - (t.updatedAt || 0) < 86400000));
    this.tasks = keep;
    store.set('taskQueue', keep);
    this.emit('queue:update', this.list());
  }

  add({ goal, agentIds = [], priority = 3, retries = 1, mode, dependsOn = [], delaySec = 0 } = {}) {
    this.load();
    if (!goal || !String(goal).trim()) return { ok: false, error: 'Пустая цель' };
    const task = {
      id: 'task-' + randomUUID().slice(0, 8),
      goal: String(goal).slice(0, 4000),
      agentIds: Array.isArray(agentIds) ? agentIds : [],
      mode: mode || (agentIds.length > 1 ? 'swarm' : 'single'),
      priority: Math.max(1, Math.min(5, +priority || 3)),
      retries: Math.max(0, Math.min(5, +retries || 0)),
      dependsOn: Array.isArray(dependsOn) ? dependsOn.slice(0, 10) : [],
      runAt: delaySec > 0 ? Date.now() + delaySec * 1000 : 0,
      attempts: 0,
      status: 'queued',
      progress: 0,
      result: null,
      error: null,
      note: '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.tasks.push(task);
    this.save();
    this.emit('task:added', task);
    this.process();
    return { ok: true, task };
  }

  // Зависимости выполнены (все depends-задачи completed)?
  depsReady(task) {
    if (!task.dependsOn || !task.dependsOn.length) return true;
    return task.dependsOn.every((depId) => {
      const dep = this.tasks.find((x) => x.id === depId);
      return !dep || dep.status === 'completed';
    });
  }

  nextQueued() {
    const now = Date.now();
    return this.tasks
      .filter((t) => t.status === 'queued' && (!t.runAt || t.runAt <= now) && this.depsReady(t))
      .sort((a, b) => (b.priority - a.priority) || (a.createdAt - b.createdAt))[0];
  }

  // Когда есть отложенные/ждущие задачи — перепланируем процесс.
  scheduleRecheck() {
    const now = Date.now();
    const pending = this.tasks.filter((t) => t.status === 'queued' && t.runAt && t.runAt > now);
    if (!pending.length) return;
    const soonest = Math.min(...pending.map((t) => t.runAt));
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.process(), Math.max(500, soonest - now + 50));
  }

  async process() {
    this.load();
    if (this.paused) return;
    while (this.running.size < this.maxConcurrent()) {
      const task = this.nextQueued();
      if (!task) break;
      this.runTask(task); // не await — параллельно
    }
    this.scheduleRecheck();
  }

  setPaused(v) {
    this.load();
    this.paused = !!v;
    store.set('taskQueuePaused', this.paused);
    this.emit('queue:update', this.list());
    if (!this.paused) this.process();
    return { ok: true, paused: this.paused };
  }

  async runTask(task) {
    this.running.add(task.id);
    task.status = 'running';
    task.attempts++;
    task.progress = 5;
    task.updatedAt = Date.now();
    task.sessionId = 'tq-' + task.id + '-' + task.attempts;
    this.emit('task:started', task);
    this.save();

    const agentMod = require('./agent');
    const onProgress = (note, pct) => {
      if (task.status !== 'running') return;
      if (note) task.note = String(note).slice(0, 200);
      if (pct != null) task.progress = Math.max(task.progress, Math.min(95, pct));
      task.updatedAt = Date.now();
      this.emit('task:progress', { id: task.id, note: task.note, progress: task.progress });
    };

    try {
      let text;
      if (task.mode === 'swarm' && task.agentIds.length > 1) {
        const swarm = require('./swarm');
        const r = await swarm.run({ goal: task.goal, agentIds: task.agentIds }, (ch, data) => {
          if (ch === 'swarm:status') onProgress(data.message, task.progress + 5);
          else if (ch === 'swarm:step') onProgress(`${data.agent}: ${data.state}`, task.progress + 8);
        });
        text = r.final || (r.ok ? 'Готово' : r.error);
      } else {
        const agentId = task.agentIds[0] || null;
        // Лёгкий прогресс по вызовам инструментов.
        const sink = (ch) => { if (ch === 'agents:tool') onProgress('инструмент…', task.progress + 7); };
        const r = await agentMod.chat({ agentId, sessionId: task.sessionId, message: task.goal, history: [] }, sink);
        text = r.text;
      }
      if (task.status === 'cancelled') return this.finish(task);
      task.status = 'completed';
      task.result = String(text || '');
      task.progress = 100;
      task.note = '';
    } catch (e) {
      if (task.attempts <= task.retries) {
        task.status = 'queued'; // повтор
        task.note = 'повтор после ошибки: ' + e.message;
      } else {
        task.status = 'failed';
        task.error = e.message;
      }
    } finally {
      this.finish(task);
    }
  }

  finish(task) {
    this.running.delete(task.id);
    task.updatedAt = Date.now();
    this.emit('task:finished', task);
    this.save();
    this.process(); // следующая
  }

  cancel(id) {
    this.load();
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return { ok: false };
    if (task.status === 'queued') { task.status = 'cancelled'; task.updatedAt = Date.now(); }
    else if (task.status === 'running') {
      task.status = 'cancelled';
      try { require('./agent').stopSession(task.sessionId); } catch {}
    }
    this.save();
    return { ok: true };
  }

  retry(id) {
    this.load();
    const task = this.tasks.find((t) => t.id === id);
    if (!task || !TERMINAL.includes(task.status)) return { ok: false };
    task.status = 'queued'; task.attempts = 0; task.error = null; task.result = null; task.progress = 0; task.updatedAt = Date.now();
    this.save();
    this.process();
    return { ok: true };
  }

  remove(id) { this.load(); this.tasks = this.tasks.filter((t) => t.id !== id); this.save(); return { ok: true }; }
  clearDone() { this.load(); this.tasks = this.tasks.filter((t) => !TERMINAL.includes(t.status)); this.save(); return { ok: true }; }

  duplicate(id) {
    this.load();
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return { ok: false };
    return this.add({ goal: t.goal, agentIds: t.agentIds, priority: t.priority, retries: t.retries, mode: t.mode });
  }

  setPriority(id, priority) {
    this.load();
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return { ok: false };
    t.priority = Math.max(1, Math.min(5, +priority || t.priority));
    t.updatedAt = Date.now();
    this.save();
    this.process();
    return { ok: true, priority: t.priority };
  }

  // Запустить отложенную/ждущую задачу немедленно.
  runNow(id) {
    this.load();
    const t = this.tasks.find((x) => x.id === id);
    if (!t || t.status !== 'queued') return { ok: false };
    t.runAt = 0; t.dependsOn = []; t.updatedAt = Date.now();
    this.save();
    this.process();
    return { ok: true };
  }
}

module.exports = new TaskQueue();
