/* sim.js — 确定性运行模拟内核
   同一时刻的所有访客得到同一组数据；数值随真实时间平滑变化，无随机跳变。 */

export const CANON = {
  axisKm: 35786,
  counterKm: 4200,
  totalKm: 39986,
  speedPax: 1200,
  speedFreight: 600,
  hoursPax: 30,
  hoursFreight: 60,
  capUp: 800,
  capDown: 600,
  capPax: 500,
  axisPower: 500,
  crownPower: 500,
  reactors: 5,
  reactorMW: 120,
  population: 52000,
  waterReserve: 20000,
  nodes: 8,
  massAxis: 8000,
  massCrown: 320
};

const DAY = 86400000;
const H = 3600000;
const TAU = Math.PI * 2;

/* 现实时间 → 2051 年同一月日时刻 */
export function fictionDelta(now = Date.now()) {
  const d = new Date(now);
  const f = new Date(now);
  f.setFullYear(d.getFullYear() + 25);
  return f.getTime() - now;
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const w = (t, periodH, phase) => Math.sin((t / (periodH * H) + phase) * TAU);
const mix = (t, base, amp, p1, p2, ph1, ph2) =>
  base + amp * (0.62 * w(t, p1, ph1) + 0.38 * w(t, p2, ph2));

function hash(n) {
  n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4);
  n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15);
  return (n >>> 0) / 4294967296;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const dayStart = (t) => Math.floor(t / DAY) * DAY;

/* ---------- 连续遥测 ---------- */
function rates(t) {
  return {
    up: 33.3 * (1 + 0.012 * w(t, 6.5, 0.12) + 0.003 * w(t, 0.9, 0.45)),
    down: 25.0 * (1 + 0.011 * w(t, 8.7, 0.47) + 0.003 * w(t, 1.3, 0.2)),
    pax: 16.5 * (1 + 0.010 * w(t, 6.1, 0.33))
  };
}

export function todayTotals(t) {
  const start = dayStart(t);
  let up = 0, down = 0, pax = 0;
  const step = 20 * 60000;
  for (let s = start; s < t; s += step) {
    const r = rates(s + step / 2);
    const f = Math.min(step, t - s) / H;
    up += r.up * f; down += r.down * f; pax += r.pax * f;
  }
  return { up, down, pax };
}

export function telemetry(t) {
  const r = rates(t);
  const axisPower = 438 * (1 + 0.007 * w(t, 5.7, 0.21));
  const crownPower = 436 * (1 + 0.006 * w(t, 9.1, 0.66));
  const reactorOn = 4;
  const reactorMW = reactorOn * CANON.reactorMW * (0.972 + 0.005 * w(t, 3.3, 0.4));
  const waterCycle = ((t % (7 * DAY)) / (7 * DAY));
  const water = 19960 - waterCycle * 640;
  const pop = Math.round(mix(t, 51980, 95, 11, 3.7, 0.5, 0.2));
  const tt = todayTotals(t);
  return {
    t,
    rates: r,
    axisPower, crownPower, reactorOn, reactorMW,
    totalPower: axisPower + crownPower,
    groundSupply: Math.max(0, axisPower + crownPower - reactorMW),
    upRate: r.up, downRate: r.down,
    upToday: tt.up, downToday: tt.down, paxToday: tt.pax,
    tension: 99.86 + 0.04 * w(t, 13, 0.35) + 0.008 * w(t, 2.1, 0.77),
    availability: 99.95 + 0.03 * w(t, 17, 0.2),
    tempGround: 30 + 1.2 * w(t, 9, 0.1),
    tempMid: -12 + 1.5 * w(t, 8, 0.3),
    tempHigh: -52 + 2.0 * w(t, 10, 0.6),
    water, waterPct: water / CANON.waterReserve * 100,
    food: 65.2 + 0.4 * w(t, 19, 0.44),
    pop: Math.round(51980 + 25 * w(t, 11, 0.5)),
    o2: 20.9 + 0.03 * w(t, 5, 0.2),
    cabinTemp: 22 + 0.15 * w(t, 4, 0.7),
    humidity: 45 + 0.8 * w(t, 7, 0.9),
    delay: Math.max(0, 0.4 + 0.35 * w(t, 5.5, 0.2)),
    queue: 2 + Math.round(1.5 + 1.5 * w(t, 4.4, 0.1))
  };
}

/* ---------- 班次与在途 ---------- */
const DEP = {
  paxUp: [6, 18], paxDown: [8, 20],
  frUp: [0, 6, 12, 18], frDown: [3, 9, 15, 21]
};
const pad = (n) => String(n).padStart(2, '0');
export const hhmm = (ms) => { const d = new Date(ms); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
export const dateStr = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };

export function departures(t) {
  const out = [];
  const d0 = dayStart(t);
  for (let day = -2; day <= 1; day++) {
    const base = d0 + day * DAY;
    const push = (type, dir, hour, cars, cap) => {
      for (let i = 0; i < cars; i++) {
        const dep = base + hour * H;
        const dur = (type === 'pax' ? CANON.hoursPax : CANON.hoursFreight) * H;
        const arrive = dep + dur;
        const prog = (t - dep) / dur;
        if (prog > -0.05 && prog < 1.05) {
          const load = type === 'pax' ? 42 + i * 6 : 18 + i * 4;
          out.push({
            id: `${type === 'pax' ? 'P' : 'F'}-${dir === 'up' ? 'U' : 'D'}-${pad(hour)}${i + 1}`,
            type, dir, dep, arrive, dur, prog, cap, load,
            km: dir === 'up' ? Math.max(0, Math.min(1, prog)) * CANON.axisKm : (1 - Math.max(0, Math.min(1, prog))) * CANON.axisKm,
            state: prog < 0 ? 'boarding' : prog >= 1 ? 'arrived' : 'transit'
          });
        }
      }
    };
    push('pax', 'up', DEP.paxUp[0], 3, 50);
    push('pax', 'down', DEP.paxDown[0], 3, 50);
    for (const h of DEP.frUp) push('fr', 'up', h, 2, 20);
    for (const h of DEP.frDown) push('fr', 'down', h, 2, 20);
  }
  return out.sort((a, b) => a.dep - b.dep);
}

/* 在途：按周转池生成，数量受在役舱数约束（客运 12 / 货运 24） */
export function transit(t) {
  const out = [];
  const paxN = 8 + Math.round(1.5 * w(t, 3.1, 0.2) + 1.5);
  const frN = 16 + Math.round(3 * w(t, 4.3, 0.7));
  const mk = (type, i, n, dir) => {
    const dur = (type === 'pax' ? CANON.hoursPax : CANON.hoursFreight) * H;
    const ph = hash(i * 97 + (type === 'pax' ? 11 : 53));
    const prog = ((t / dur) + ph) % 1;
    const dep = t - prog * dur;
    return {
      id: `${type === 'pax' ? 'P' : 'F'}-${dir === 'up' ? 'U' : 'D'}-${String(i + 1).padStart(2, '0')}`,
      type, dir, prog, dep, arrive: dep + dur, dur,
      km: dir === 'up' ? prog * CANON.axisKm : (1 - prog) * CANON.axisKm,
      cap: type === 'pax' ? 50 : 20,
      load: type === 'pax' ? 42 + Math.round(hash(i * 31 + 7) * 34) : 18 + Math.round(hash(i * 29 + 5) * 20),
      state: 'transit'
    };
  };
  for (let i = 0; i < paxN; i++) out.push(mk('pax', i, paxN, i % 2 === 0 ? 'up' : 'down'));
  for (let i = 0; i < frN; i++) out.push(mk('fr', i, frN, i % 2 === 0 ? 'up' : 'down'));
  return out.sort((a, b) => b.prog - a.prog);
}

export function nextDepartures(t, n = 8) {
  const d0 = dayStart(t);
  const out = [];
  for (let day = 0; day <= 1; day++) {
    const base = d0 + day * DAY;
    const add = (type, dir, hour, cars) => {
      const dep = base + hour * H;
      if (dep > t) out.push({ type, dir, dep, cap: type === 'pax' ? 50 : 20, pods: cars, id: `${type === 'pax' ? 'P' : 'F'}-${dir === 'up' ? 'U' : 'D'}-${pad(hour)}` });
    };
    add('pax', 'up', DEP.paxUp[0], 3); add('pax', 'down', DEP.paxDown[0], 3);
    DEP.frUp.forEach(h => add('fr', 'up', h, 2));
    DEP.frDown.forEach(h => add('fr', 'down', h, 2));
  }
  return out.sort((a, b) => a.dep - b.dep).slice(0, n);
}

/* ---------- 事件（按“事件包”生成，同一包内因果自洽） ---------- */
const INCIDENTS = [
  {
    domain: 'axis', sev: 'warn',
    title: { zh: '轨道碎片接近', en: 'Orbital debris approach' },
    events: [
      { dt: 0, sev: 'warn', zh: '空间监视网发现碎片云 DEB-{n}，最近接近距离约 12 km', en: 'Space surveillance detected debris cloud DEB-{n}, closest approach ~12 km' },
      { dt: 2, sev: 'info', zh: '上行速率降至 70%，暂停新发车', en: 'Upbound rate reduced to 70%; new departures held' },
      { dt: 6, sev: 'info', zh: '在途货运舱降速至 400 km/h，保持安全间距', en: 'In-transit freight pods slowed to 400 km/h for separation' },
      { dt: 14, sev: 'ok', zh: '碎片过境，最近距离 8.4 km，无碰撞', en: 'Debris passed at 8.4 km; no impact' },
      { dt: 22, sev: 'ok', zh: '恢复 100% 运力，积压 3 舱开始疏解', en: 'Capacity restored to 100%; backlog of 3 pods clearing' }
    ]
  },
  {
    domain: 'axis', sev: 'warn',
    title: { zh: '索系热异常', en: 'Tether thermal excursion' },
    events: [
      { dt: 0, sev: 'warn', zh: 'N05–N06 段索温较基线高 6.2°C，进入热观察', en: 'Tether N05–N06 +6.2°C above baseline; thermal watch' },
      { dt: 3, sev: 'info', zh: '主动热控提升散热板流量至 82%', en: 'Active thermal control raised radiator flow to 82%' },
      { dt: 11, sev: 'ok', zh: '索温回落至基线 +2.1°C', en: 'Tether temperature down to +2.1°C' },
      { dt: 20, sev: 'ok', zh: '热观察解除，参数恢复正常', en: 'Thermal watch lifted; parameters normal' }
    ]
  },
  {
    domain: 'axis', sev: 'warn',
    title: { zh: '货运舱热控', en: 'Freight pod thermal control' },
    events: [
      { dt: 0, sev: 'warn', zh: '货运舱 F-U-{n} 外层温度 78°C，超阈值 3°C', en: 'Freight pod F-U-{n} shell 78°C, 3°C above threshold' },
      { dt: 2, sev: 'info', zh: '该舱降速 20% 并调整姿态角，增加迎风散热', en: 'Pod slowed 20% and attitude adjusted for radiative cooling' },
      { dt: 8, sev: 'ok', zh: '舱体温度降至 71°C，回到阈值内', en: 'Pod temperature down to 71°C, within threshold' },
      { dt: 14, sev: 'ok', zh: '恢复巡航速度，记录归档', en: 'Cruise speed restored; log archived' }
    ]
  },
  {
    domain: 'crown', sev: 'warn',
    title: { zh: '传导功率波动', en: 'Power feed fluctuation' },
    events: [
      { dt: 0, sev: 'warn', zh: '世界之轴传导功率波动 ±18 MW，母线电压偏移', en: 'Axis power feed fluctuating ±18 MW; bus voltage offset' },
      { dt: 1, sev: 'info', zh: '自载堆 R03 并网补偿，切换时间 42 s', en: 'Reactor R03 brought online for compensation in 42 s' },
      { dt: 7, sev: 'ok', zh: '波动收敛至 ±3 MW', en: 'Fluctuation narrowed to ±3 MW' },
      { dt: 13, sev: 'ok', zh: '恢复地面供电，R03 转备用', en: 'Ground feed restored; R03 back to standby' }
    ]
  },
  {
    domain: 'crown', sev: 'normal',
    title: { zh: '微陨石撞击', en: 'Micrometeoroid impact' },
    events: [
      { dt: 0, sev: 'info', zh: '外环传感器记录微陨石撞击，能量约 0.4 J', en: 'Outer ring sensor logged a micrometeoroid impact, ~0.4 J' },
      { dt: 2, sev: 'info', zh: '巡检机器人前往外环 03 区', en: 'Inspection robot dispatched to outer ring sector 03' },
      { dt: 9, sev: 'ok', zh: '确认无穿透，仅表面凹坑 3 mm', en: 'No penetration; 3 mm surface pit only' },
      { dt: 15, sev: 'ok', zh: '检查完成，事件归档', en: 'Inspection complete; event archived' }
    ]
  },
  {
    domain: 'crown', sev: 'warn',
    title: { zh: '水循环回路压降', en: 'Water loop pressure drop' },
    events: [
      { dt: 0, sev: 'warn', zh: '水循环 02 回路压力下降 3%，切换备用', en: 'Water loop 02 pressure down 3%; switching to standby' },
      { dt: 2, sev: 'info', zh: '备用回路接管，站内用水不受影响', en: 'Standby loop took over; station water supply unaffected' },
      { dt: 7, sev: 'info', zh: '定位为密封圈微渗，准备更换', en: 'Traced to a seal micro-leak; replacement scheduled' },
      { dt: 25, sev: 'ok', zh: '密封圈更换完成，主回路恢复', en: 'Seal replaced; primary loop restored' }
    ]
  },
  {
    domain: 'axis', sev: 'normal',
    title: { zh: '备用链路衰减', en: 'Backup link degradation' },
    events: [
      { dt: 0, sev: 'info', zh: '激光备用链路信噪比下降 4 dB', en: 'Laser backup link SNR down 4 dB' },
      { dt: 2, sev: 'info', zh: '切换至世界之轴光纤主链路', en: 'Switched to Axis fiber primary' },
      { dt: 6, sev: 'ok', zh: '定位为地面站云层衰减，非设备故障', en: 'Cause: cloud attenuation at ground station, not equipment' },
      { dt: 12, sev: 'ok', zh: '双链路恢复，主备正常', en: 'Both links restored' }
    ]
  },
  {
    domain: 'axis', sev: 'normal',
    title: { zh: '节点计划维护', en: 'Scheduled node maintenance' },
    events: [
      { dt: 0, sev: 'info', zh: 'N03 进入计划维护窗口（B 级）', en: 'N03 entered scheduled maintenance window (Tier B)' },
      { dt: 2, sev: 'info', zh: '巡检机器人上线，负载转移至 N02 / N04', en: 'Inspection robots online; load shifted to N02 / N04' },
      { dt: 18, sev: 'ok', zh: '维护完成，N03 恢复承载', en: 'Maintenance complete; N03 back in service' }
    ]
  },
  {
    domain: 'axis', sev: 'normal',
    title: { zh: '班次配载调整', en: 'Departure load balancing' },
    events: [
      { dt: 0, sev: 'info', zh: '客运班次 P-U-06 因配载顺延 12 分钟', en: 'Passenger service P-U-06 delayed 12 min for load balancing' },
      { dt: 3, sev: 'info', zh: '货运 F-U-06 优先放行，占用上行窗口', en: 'Freight F-U-06 cleared first, using the upbound slot' },
      { dt: 15, sev: 'ok', zh: 'P-U-06 发车，延误 12 分钟', en: 'P-U-06 departed with 12 min delay' }
    ]
  },
  {
    domain: 'crown', sev: 'warn',
    title: { zh: '空间天气', en: 'Space weather' },
    events: [
      { dt: 0, sev: 'warn', zh: '太阳活动增强，GEO 粒子通量升至基线 3.2 倍', en: 'Solar activity rising; GEO particle flux 3.2× baseline' },
      { dt: 4, sev: 'info', zh: '外层舱段辐射屏蔽提升，取消非必要出舱', en: 'Outer-ring shielding raised; non-essential EVA cancelled' },
      { dt: 30, sev: 'ok', zh: '粒子通量回落至基线 1.4 倍', en: 'Particle flux down to 1.4× baseline' },
      { dt: 36, sev: 'ok', zh: '解除辐射观察', en: 'Radiation watch lifted' }
    ]
  }
];

const SLOT = 60 * 60000;
const fill = (s, n) => s.replace(/\{n\}/g, String(n));

function buildIncident(tpl, start, slot, now) {
  const d = new Date(start);
  const incId = `INC-${String(d.getUTCFullYear()).slice(2)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${String(Math.abs(slot) % 1000).padStart(3, '0')}`;
  const n = 101 + Math.floor(hash(slot * 17 + 9) * 899);
  const all = tpl.events.map((e, i) => ({
    t: start + e.dt * 60000,
    zh: fill(e.zh, n), en: fill(e.en, n),
    sev: e.sev,
    id: `${incId}-${String(i + 1).padStart(2, '0')}`,
    incId
  }));
  const shown = all.filter(e => e.t <= now);
  if (!shown.length) return null;
  const end = all[all.length - 1].t;
  return {
    id: incId, domain: tpl.domain, sev: tpl.sev, title: tpl.title,
    start, end, active: now < end, events: shown
  };
}

export function incidents(t) {
  const slotNow = Math.floor(t / SLOT);
  const out = [];
  let lastIdx = -1;
  for (let s = slotNow; s >= slotNow - 32; s--) {
    const h = hash(((s * 2654435761) ^ 0x9e3779b9) >>> 0);
    if (h > 0.42) continue;
    let idx = Math.floor(hash(((s * 1103515245) ^ 0x5bd1e995) >>> 0) * INCIDENTS.length) % INCIDENTS.length;
    if (idx === lastIdx) idx = (idx + 1) % INCIDENTS.length;
    lastIdx = idx;
    const start = s * SLOT + Math.floor(hash(s * 13 + 5) * SLOT * 0.55);
    if (start > t || start < t - DAY) continue;
    const inc = buildIncident(INCIDENTS[idx], start, s, t);
    if (inc) out.push(inc);
  }
  return out.sort((a, b) => b.start - a.start);
}

export function events(t) {
  return incidents(t).flatMap(i => i.events).sort((a, b) => b.t - a.t);
}

/* ---------- 维护 ---------- */
const F_YEARS = [1988, 1993, 1998, 2003, 2008, 2013, 2018, 2023, 2028, 2033, 2038, 2043, 2048, 2053];
export function maintenance(t) {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const nextF = F_YEARS.find(v => v > y) || 2053;
  const fDate = Date.UTC(nextF, 2, 1);
  const daysToF = Math.ceil((fDate - t) / DAY);
  const due = [
    { k: 'A', zh: '每日巡检', en: 'Daily inspection', cycle: '24H', next: dayStart(t) + DAY },
    { k: 'B', zh: '每周切换测试', en: 'Weekly switch test', cycle: '7D', next: dayStart(t) + DAY * 2 },
    { k: 'C', zh: '月度系统诊断', en: 'Monthly diagnostics', cycle: '30D', next: Date.UTC(y, d.getUTCMonth() + 1, 1) },
    { k: 'D', zh: '季度大修', en: 'Quarterly overhaul', cycle: '90D', next: Date.UTC(y, Math.floor(d.getUTCMonth() / 3) * 3 + 3, 1) },
    { k: 'E', zh: '年度全段大修', en: 'Annual full overhaul', cycle: '365D', next: Date.UTC(y + 1, 2, 1) },
    { k: 'F', zh: '五年深度大修', en: 'Five-year deep overhaul', cycle: '5Y', next: fDate }
  ];
  const r = rng(Math.floor(dayStart(t) / DAY) * 40503 % 4294967296);
  const systems = ['主索张力锚定', '攀爬轨道 02', '中继节点 06', '对接端口密封', '散热板阵列', '钍基熔盐堆 03', '水循环核心', '货运分拣中心'];
  const orders = Array.from({ length: 6 }, (_, i) => {
    const st = r();
    return {
      id: `WO-${y}-${String(100 + Math.floor(r() * 800))}`,
      sys: systems[Math.floor(r() * systems.length)],
      due: t + (Math.floor(r() * 72) - 12) * H,
      state: st < 0.32 ? 'active' : st < 0.62 ? 'queued' : 'done',
      crew: 2 + Math.floor(r() * 6)
    };
  }).sort((a, b) => a.due - b.due);
  return { due, daysToF, nextF, orders, robots: { total: 200, active: 150 + Math.floor(r() * 38) } };
}

/* ---------- 环段 ---------- */
export function rings(t) {
  const base = [
    { zh: '行政环', en: 'Administration', pop: 8000, load: 0.62 },
    { zh: '教育环', en: 'Education', pop: 15000, load: 0.78 },
    { zh: '医疗环', en: 'Medical', pop: 6000, load: 0.56 },
    { zh: '居住环', en: 'Habitation', pop: 18000, load: 0.71 },
    { zh: '工业环', en: 'Industrial', pop: 5000, load: 0.48 }
  ];
  return base.map((r, i) => ({
    ...r,
    load: clamp(r.load + 0.06 * w(t, 5 + i, i * 0.17), 0.2, 0.96)
  }));
}

export function nodes(t) {
  const cars = transit(t);
  const out = [];
  for (let i = 0; i < 8; i++) {
    const km = (i + 1) * 5000;
    const ph = i * 0.37;
    const baseLoad = [54, 59, 63, 67, 70, 66, 61, 56][i];
    const load = baseLoad + 0.9 * w(t, 5.2 + i * 0.3, ph);
    const lat = [2.1, 2.7, 3.3, 3.9, 4.6, 5.2, 5.9, 6.6][i] + 0.12 * w(t, 3.4 + i * 0.2, ph);
    const temp = 31 - i * 12.5 + 0.8 * w(t, 7 + i * 0.4, ph) - (i > 5 ? 5 : 0);
    const power = 48 - i * 2 + 1.2 * w(t, 6.1 + i * 0.3, ph);
    const seg = cars.filter(c => c.km >= km - 2500 && c.km < km + 2500).length;
    const d = new Date(t);
    const hour = d.getUTCHours(), min = d.getUTCMinutes();
    const maint = hour === 9 + i && min < 20;
    const advisory = i === 5 && hour === 15 && min < 10;
    out.push({
      id: `N${String(i + 1).padStart(2, '0')}`, km, load, lat, temp, power, cars: seg,
      state: advisory ? 'warn' : maint ? 'maint' : 'ok',
      uptime: 99.9 - hash(i * 7 + 1) * 0.12
    });
  }
  return out;
}

export function snapshot(t) {
  return { ...telemetry(t), transit: transit(t), nodes: nodes(t), next: nextDepartures(t), events: events(t), incidents: incidents(t), maint: maintenance(t), rings: rings(t) };
}
