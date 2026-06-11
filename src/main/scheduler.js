// Планировщик задач: запуск, интервал, расписание, событие включения ПК.
const { randomUUID } = require('crypto');
const store = require('./store');

let hooks = {};
const timers = new Map(); // taskId -> intervalId

function init(h) {
  hooks = h;
  // Задачи «при включении» (тип onStartup) выполняются один раз при старте.
  const tasks = listTasks();
  for (const t of tasks) {
    if (t.enabled && t.trigger === 'onStartup') fire(t);
    if (t.enabled && t.trigger === 'interval') arm(t);
    if (t.enabled && t.trigger === 'daily') armDaily(t);
  }
}

function shutdown() {
  for (const id of timers.values()) clearInterval(id);
  timers.clear();
}

function listTasks() { return store.get('tasks', []); }

function saveTask(task) {
  const list = listTasks();
  if (!task.id) task.id = 'task-' + randomUUID().slice(0, 8);
  const idx = list.findIndex((t) => t.id === task.id);
  if (idx >= 0) list[idx] = task; else list.push(task);
  store.set('tasks', list);
  rearm(task);
  return task;
}

function deleteTask(id) {
  store.set('tasks', listTasks().filter((t) => t.id !== id));
  if (timers.has(id)) { clearInterval(timers.get(id)); timers.delete(id); }
  return { ok: true };
}

function toggleTask(id, enabled) {
  const list = listTasks();
  const t = list.find((x) => x.id === id);
  if (!t) return { ok: false };
  t.enabled = enabled;
  store.set('tasks', list);
  rearm(t);
  return { ok: true };
}

function rearm(task) {
  if (timers.has(task.id)) { clearInterval(timers.get(task.id)); timers.delete(task.id); }
  if (!task.enabled) return;
  if (task.trigger === 'interval') arm(task);
  if (task.trigger === 'daily') armDaily(task);
}

function arm(task) {
  const ms = Math.max(1, parseInt(task.intervalMinutes || 60, 10)) * 60 * 1000;
  const id = setInterval(() => fire(task), ms);
  timers.set(task.id, id);
}

function armDaily(task) {
  // Проверяем каждую минуту, не настало ли время HH:MM.
  const id = setInterval(() => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    if (`${hh}:${mm}` === (task.time || '09:00')) fire(task);
  }, 60 * 1000);
  timers.set(task.id, id);
}

async function fire(task) {
  // Обновляем отметку последнего запуска.
  const list = listTasks();
  const t = list.find((x) => x.id === task.id);
  if (t) { t.lastRun = Date.now(); store.set('tasks', list); }

  hooks.notify && hooks.notify({ taskId: task.id, name: task.name, at: Date.now() });

  if (task.action === 'speak' && hooks.speak) {
    hooks.speak(task.speakText || task.prompt || 'Запланированная задача выполнена.');
    return;
  }
  if (task.action === 'agent' && hooks.runAgentTask) {
    await hooks.runAgentTask(task);
  }
}

function runNow(id) {
  const t = listTasks().find((x) => x.id === id);
  if (t) fire(t);
  return { ok: true };
}

module.exports = { init, shutdown, listTasks, saveTask, deleteTask, toggleTask, runNow };
