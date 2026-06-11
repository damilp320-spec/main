// Управление громкостью системы.
// Windows: через Core Audio API (IAudioEndpointVolume) инлайн-PowerShell —
// точная установка/чтение громкости и mute. Linux/mac — pactl/amixer/osascript.
const { exec } = require('child_process');

function run(cmd) {
  return new Promise((resolve) => exec(cmd, { windowsHide: true, timeout: 8000 }, (err, out, errout) => resolve({ ok: !err, out: (out || '').trim(), err: (errout || '').trim() })));
}

// PowerShell-сниппет, добавляющий тип [Audio] с доступом к громкости устройства.
const PS_AUDIO = `Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, System.Guid pguidEventContext);
  int GetMute(out bool pbMute); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDevice { int Activate(ref System.Guid id, int clsCtx, int actParams, out IAudioEndpointVolume aev); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport,Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
public class Audio {
  static IAudioEndpointVolume Vol() {
    var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject()); IMMDevice dev; en.GetDefaultAudioEndpoint(0,1,out dev);
    System.Guid g = typeof(IAudioEndpointVolume).GUID; IAudioEndpointVolume aev; dev.Activate(ref g,1,0,out aev); return aev; }
  public static float Get(){ float v; Vol().GetMasterVolumeLevelScalar(out v); return v; }
  public static void Set(float v){ Vol().SetMasterVolumeLevelScalar(v, System.Guid.Empty); }
  public static void Mute(bool m){ Vol().SetMute(m, System.Guid.Empty); }
  public static bool IsMuted(){ bool m; Vol().GetMute(out m); return m; }
}
"@`;

async function ps(action) {
  const cmd = `powershell -NoProfile -Command "${PS_AUDIO}; ${action}"`;
  return run(cmd);
}

async function getVolume() {
  if (process.platform === 'win32') {
    const r = await ps('[math]::Round([Audio]::Get()*100)');
    const v = parseInt(r.out, 10);
    return { ok: !isNaN(v), percent: isNaN(v) ? null : v };
  }
  if (process.platform === 'darwin') {
    const r = await run("osascript -e 'output volume of (get volume settings)'");
    return { ok: r.ok, percent: parseInt(r.out, 10) };
  }
  const r = await run("pactl get-sink-volume @DEFAULT_SINK@ 2>/dev/null | grep -o '[0-9]*%' | head -1");
  return { ok: r.ok, percent: parseInt(r.out, 10) };
}

async function setVolume(percent) {
  percent = Math.max(0, Math.min(100, Math.round(percent)));
  if (process.platform === 'win32') { await ps(`[Audio]::Set(${(percent / 100).toFixed(3)})`); return { ok: true, percent }; }
  if (process.platform === 'darwin') { await run(`osascript -e 'set volume output volume ${percent}'`); return { ok: true, percent }; }
  await run(`pactl set-sink-volume @DEFAULT_SINK@ ${percent}%`);
  return { ok: true, percent };
}

async function adjust(delta) {
  const cur = await getVolume();
  const base = cur.percent == null ? 50 : cur.percent;
  return setVolume(base + delta);
}

async function mute(state) {
  if (process.platform === 'win32') { await ps(`[Audio]::Mute($${state ? 'true' : 'false'})`); return { ok: true, muted: !!state }; }
  if (process.platform === 'darwin') { await run(`osascript -e 'set volume ${state ? 'with' : 'without'} output muted'`); return { ok: true, muted: !!state }; }
  await run(`pactl set-sink-mute @DEFAULT_SINK@ ${state ? 1 : 0}`);
  return { ok: true, muted: !!state };
}

/* ------ Инструменты для агентов ------ */
const toolSchemas = [
  { type: 'function', function: { name: 'set_volume', description: 'Установить громкость системы в процентах (0-100).', parameters: { type: 'object', properties: { percent: { type: 'number' } }, required: ['percent'] } } },
  { type: 'function', function: { name: 'change_volume', description: 'Изменить громкость на величину (например +10 или -15 процентов).', parameters: { type: 'object', properties: { delta: { type: 'number' } }, required: ['delta'] } } },
  { type: 'function', function: { name: 'mute_audio', description: 'Выключить (true) или включить (false) звук.', parameters: { type: 'object', properties: { mute: { type: 'boolean' } }, required: ['mute'] } } },
  { type: 'function', function: { name: 'get_volume', description: 'Узнать текущую громкость системы.', parameters: { type: 'object', properties: {} } } }
];

const toolHandlers = {
  async set_volume({ percent }) { const r = await setVolume(percent); return r.ok ? `Громкость: ${r.percent}%` : 'Не удалось'; },
  async change_volume({ delta }) { const r = await adjust(+delta); return r.ok ? `Громкость: ${r.percent}%` : 'Не удалось'; },
  async mute_audio({ mute: m }) { const r = await mute(m); return r.ok ? (m ? 'Звук выключен' : 'Звук включён') : 'Не удалось'; },
  async get_volume() { const r = await getVolume(); return r.percent == null ? 'Не удалось узнать' : `Текущая громкость: ${r.percent}%`; }
};

module.exports = { getVolume, setVolume, adjust, mute, toolSchemas, toolHandlers };
