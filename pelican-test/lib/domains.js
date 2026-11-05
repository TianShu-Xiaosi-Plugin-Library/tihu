/**
 * 星域参考表 —— 帮用户用中文名，不是准入门槛。
 *
 * 表里的 id 和图标来自实测（对每个 id 打 POST /sessions，看回执里的 domainGlyph；
 * 有专属图标的才是真星域）。但这只是「已知」清单，不是白名单：
 * 用户想填什么都没问题，宿主不认识的会落到兜底图标 ⚙，那时如实告诉他即可。
 *
 * 复核：node bin/probe-domains.mjs --root=<天枢 .rivet 根>
 */
export const DOMAINS = [
  { id: 'tianshu', name: '天枢', glyph: '✵' },
  { id: 'pojun', name: '破军', glyph: '☄' },
  { id: 'tianquan', name: '天权', glyph: '⚖' },
  { id: 'tianji', name: '天机', glyph: '⚝' },
  { id: 'tianxuan', name: '天璇', glyph: '☾' },
  { id: 'yaoguang', name: '瑶光', glyph: '↻' },
  { id: 'changgeng', name: '长庚', glyph: '☽' },
  { id: 'taiyi', name: '太一', glyph: '◉' },
  { id: 'tianfu', name: '天府', glyph: '❖' },
  { id: 'tianliang', name: '天梁', glyph: '✧' },
  { id: 'wenqu', name: '文曲', glyph: '✺' },
  { id: 'kaiyang', name: '开阳', glyph: '☌' },
  { id: 'qiming', name: '启明', glyph: '☥' },
  { id: 'fu', name: '辅', glyph: '⊕' },
  { id: 'huagai', name: '华盖', glyph: '☉' },
]

/** 宿主不认识某个星域时给的图标。看到它就说明这次没跑到想要的星域上。 */
export const FALLBACK_GLYPH = '⚙'

/**
 * 把用户输入规范化成星域 id。
 *   空 → undefined（用宿主默认）
 *   已知 id / 中文名 → 规范 id
 *   其它 → 原样透传（不拦，交给宿主；认不认识由调用方按回执的 glyph 事后告知）
 */
export function resolveDomain(input) {
  if (input === undefined || input === null || String(input).trim() === '') return undefined
  const raw = String(input).trim()
  const hit = DOMAINS.find(d => d.id === raw.toLowerCase() || d.name === raw)
  return hit ? hit.id : raw
}

export function isKnownDomain(id) {
  return DOMAINS.some(d => d.id === id)
}

export function domainLabel(id) {
  if (!id) return '（宿主默认）'
  const hit = DOMAINS.find(d => d.id === id)
  return hit ? `${hit.name}(${hit.glyph})` : id
}

/** 建完会话后调：宿主认了就返回 null，没认就返回一句人话提醒。 */
export function domainWarning(domain, glyph) {
  if (!domain) return null
  if (glyph === FALLBACK_GLYPH) {
    return `宿主不认识星域「${domain}」，这个会话按默认星域建好了。想换的话用 pelican_archive 归档后重开（常用星域：${DOMAINS.map(d => d.name).join('、')}）`
  }
  return null
}
