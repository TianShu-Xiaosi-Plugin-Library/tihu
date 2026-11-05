import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DOMAINS,
  FALLBACK_GLYPH,
  domainLabel,
  domainWarning,
  isKnownDomain,
  resolveDomain,
} from '../lib/domains.js'

test('星域参考表没有重复 id / 中文名 / 图标，也不会混进兜底图标', () => {
  const ids = DOMAINS.map(d => d.id)
  const names = DOMAINS.map(d => d.name)
  const glyphs = DOMAINS.map(d => d.glyph)
  assert.equal(new Set(ids).size, ids.length, 'id 重复')
  assert.equal(new Set(names).size, names.length, '中文名重复')
  assert.equal(new Set(glyphs).size, glyphs.length, '图标重复')
  assert.equal(glyphs.includes(FALLBACK_GLYPH), false, '兜底图标不能当成某个星域的图标')
})

test('resolveDomain 认 id、认中文名，大小写不敏感', () => {
  assert.equal(resolveDomain('yaoguang'), 'yaoguang')
  assert.equal(resolveDomain('瑶光'), 'yaoguang')
  assert.equal(resolveDomain('YAOGUANG'), 'yaoguang')
  assert.equal(resolveDomain(' 开阳 '), 'kaiyang')
})

test('resolveDomain 空值表示用宿主默认，返回 undefined', () => {
  assert.equal(resolveDomain(undefined), undefined)
  assert.equal(resolveDomain(null), undefined)
  assert.equal(resolveDomain('   '), undefined)
})

test('未知星域不拦，原样透传——这是通道，不是闸门', () => {
  assert.equal(resolveDomain('tanlang'), 'tanlang')
  assert.equal(resolveDomain('kaoyang'), 'kaoyang')
  assert.equal(resolveDomain('随便写点什么'), '随便写点什么')
})

test('isKnownDomain 只对表内 id 为真', () => {
  assert.equal(isKnownDomain('yaoguang'), true)
  assert.equal(isKnownDomain('tanlang'), false)
  assert.equal(isKnownDomain(''), false)
})

test('domainLabel 给中文名 + 图标，未记录时说明是宿主默认', () => {
  assert.equal(domainLabel('yaoguang'), '瑶光(↻)')
  assert.equal(domainLabel(null), '（宿主默认）')
  assert.equal(domainLabel('unknown_thing'), 'unknown_thing')
})

test('domainWarning：宿主落了兜底图标才提醒，认出来了就不啰嗦', () => {
  const warn = domainWarning('kaoyang', FALLBACK_GLYPH)
  assert.match(warn, /不认识星域「kaoyang」/)
  assert.match(warn, /常用星域/, '提醒里要给出路，不能只说错了')

  assert.equal(domainWarning('yaoguang', '↻'), null)
  assert.equal(domainWarning(undefined, '☥'), null, '没指定星域就不该提醒')
})
