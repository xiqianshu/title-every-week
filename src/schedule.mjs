export function shanghaiDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return { day: parts.year + '-' + parts.month + '-' + parts.day, hour: Number(parts.hour), weekday: parts.weekday };
}

export function scheduleDue(config, state, now = new Date()) {
  const local = shanghaiDate(now);
  if (!config.enabled || local.hour < config.scheduleHour || state.lastDaily === local.day) return null;
  return { day: local.day, kind: !state.lastWeekly || (local.weekday === 'Mon' && state.lastWeekly !== local.day) ? 'weekly' : 'daily' };
}
