import { useSyncExternalStore } from 'react'

/** 客户 / 收货方：盒马、快乐猴、菜洋洋……可自行增补 */
export type Customer = {
  id: string
  name: string
  /** 列表里用的短名 */
  short: string
}

export type Sku = {
  id: string
  code: string
  name: string
  /** 归哪个客户 / 渠道 */
  customerId: string
  /** 规格，如 640g(8只)×12袋 */
  spec: string
  /** 箱面大字 */
  shortName: string
  /** 列表 / 标签里的短称，如「肉包」「菜包」；不填就按箱面大字推一个 */
  nick?: string
  /** 每箱装多少件（袋 / 盒） */
  perBox: number
  /** 外箱三围，毫米 */
  boxL: number
  boxW: number
  boxH: number
  /** 单箱毛重，公斤 */
  boxWeight: number
  /** 箱面牛皮纸底色 */
  boxColor: string
  /** 品牌色块 */
  accentColor: string
  /** 色块上的字色 */
  textColor: string
}

export type Batch = {
  id: string
  skuId: string
  batchNo: string
  /** 入库时的总量，只作记录；实际余量由流水算出 */
  qty: number
  /** 生产日期 YYYY-MM-DD —— 发货时按这个日期选货 */
  prodDate: string
  createdAt: number
}

export type MoveType = 'in' | 'out' | 'return' | 'adjust'

/**
 * 一条库存流水。
 * 关键设计：库存不存“当前值”，永远由流水累加得到。
 * 这样发货、退货、盘点、撤销都只是“再记一笔”，不会出现两处数字对不上。
 */
export type Move = {
  id: string
  at: number
  type: MoveType
  skuId: string
  batchId: string
  /** 带符号：正数增加库存，负数减少库存 */
  qty: number
  /** 关联单号或来源，撤销时靠它找回原流水 */
  ref: string
  note: string
  /** 已被撤销过：避免“发车→撤销→再发车→再撤销”时把库存补两次 */
  voided?: boolean
}

/**
 * 一块拖板：只放一种商品、一个生产日期。
 * 堆码按“层”描述：满层数 × 每层箱数 + 顶层箱数。
 */
export type Pallet = {
  id: string
  no: string
  skuId: string
  prodDate: string
  layers: number
  perLayer: number
  /** 顶层实际放几箱，其余层按 perLayer 放满 */
  topCount: number
  createdAt: number
}

/**
 * 一趟车的「要货计划」：这趟要发哪个品、哪个生产日期、多少箱。
 * 建车时先定计划，装板时按计划一板一板码，发车前对账。
 * 同一品不同日期是两行（例：11-02 肉包 150 箱、11-04 肉包 288 箱）。
 */
export type PlanLine = {
  id: string
  skuId: string
  prodDate: string
  /** 计划箱数 */
  boxes: number
}

export type Order = {
  id: string
  no: string
  /** 收货地，必填 */
  destination: string
  customerId: string
  remark: string
  createdAt: number
  status: 'draft' | 'shipped'
  pallets: Pallet[]
  /** 要货计划；老车次没这个字段就是「没定计划」，行为跟以前一样 */
  plan?: PlanLine[]
}

export type Truck = {
  id: string
  name: string
  L: number
  W: number
  H: number
  maxWeight: number
}

/** 一条已录入的「入库登记表」记录：保留原始文件信息，作为历史留档 */
export type InboundRecord = {
  id: string
  /** 源文件名，如「2026年成品冷库生产入库登记表.xlsx」 */
  fileName: string
  /** 录入时间 */
  at: number
  /** 本次录入的行数（写入库存的行数） */
  rows: number
  /** 新建的品项数 */
  skusCreated: number
  /** 明细行（品名 / 规格 / 生产日期 / 数量），供回看 */
  lines: { name: string; spec: string; prodDate: string; qty: number }[]
}

export type DB = {
  customers: Customer[]
  skus: Sku[]
  batches: Batch[]
  moves: Move[]
  orders: Order[]
  trucks: Truck[]
  /** 已录入的入库登记表留档，按录入时间倒序 */
  inboundRecords: InboundRecord[]
  seq: number
  /** 数据版本，用来判断要不要跑一次性补数 */
  version?: number
}

const KEY = 'inventrack.v1'

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

/** n 天前的日期，YYYY-MM-DD */
const daysAgo = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

/** 一块拖板折成多少箱 */
export const palletBoxes = (p: Pallet) =>
  Math.max(0, (Math.max(1, p.layers) - 1) * Math.max(1, p.perLayer) + Math.max(0, p.topCount))

/** 默认每层 6 箱、7 层 —— 仓库里最常见的一种码法 */
export const DEFAULT_LAYERS = 7
export const DEFAULT_PER_LAYER = 6

/** 列表、标签上用的名称：统一显示全称（如「超合算 NB 鲜汁大肉包」），不再用「肉包」这类短称 */
export function nickOf(sku: Sku) {
  return sku.name?.trim() || sku.shortName || ''
}

export const CUSTOMER_HM = 'c-hm'
export const CUSTOMER_KLH = 'c-klh'
export const CUSTOMER_CYY = 'c-cyy'

/** 盒马示例库存：这几个「几天前」作为生产日期，每个品每个日期都是 200 箱 */
export const HM_STOCK_DAYS = [9, 6, 3, 1]
export const HM_STOCK_BOXES = 200
/** 快乐猴示例库存：两个日期，每个品每个日期 100 箱 */
export const KLH_STOCK_DAYS = [4, 2]
export const KLH_STOCK_BOXES = 100

/** 数据版本：升级时靠它判断要不要补示例数据 */
const DATA_VERSION = 5

function seed(): DB {
  const customers: Customer[] = [
    { id: CUSTOMER_HM, name: '盒马', short: '盒马' },
    { id: CUSTOMER_KLH, name: '快乐猴', short: '快乐猴' },
    { id: CUSTOMER_CYY, name: '菜洋洋', short: '菜洋洋' },
    // —— 以下按 2026 年成品冷库生产入库登记表 补充的品牌（收货方）——
    { id: 'c-zhongkouxian', name: '众口鲜', short: '众口鲜' },
    { id: 'c-lengfeng', name: '冷丰', short: '冷丰' },
    { id: 'c-qiyao', name: '启肴', short: '启肴' },
    { id: 'c-weierxian', name: '味儿鲜', short: '味儿鲜' },
    { id: 'c-duoyaxianxiang', name: '哆雅鲜享', short: '哆雅鲜享' },
    { id: 'c-kenye', name: '垦野', short: '垦野' },
    { id: 'c-waipodaren', name: '外婆大人', short: '外婆大人' },
    { id: 'c-tianhe', name: '天荷', short: '天荷' },
    { id: 'c-anfuchengxiang', name: '安福呈祥', short: '安福呈祥' },
    { id: 'c-xiaolongkan', name: '小龙坎', short: '小龙坎' },
    { id: 'c-chuanweijingzao', name: '川为精造', short: '川为精造' },
    { id: 'c-chuanxiangong', name: '川鲜公', short: '川鲜公' },
    { id: 'c-laoxiansheng', name: '捞鲜生', short: '捞鲜生' },
    { id: 'c-xinyueyang', name: '欣悦阳', short: '欣悦阳' },
    { id: 'c-hanjing', name: '汉景', short: '汉景' },
    { id: 'c-piaochongxiansheng', name: '瓢虫鲜生', short: '瓢虫鲜生' },
    { id: 'c-zhenshihui', name: '甄实惠', short: '甄实惠' },
    { id: 'c-zhixianglai', name: '知享睐', short: '知享睐' },
    { id: 'c-shijian', name: '示剑', short: '示剑' },
    { id: 'c-fuyunlitianxia', name: '福运立天下', short: '福运立天下' },
    { id: 'c-qinzhiwei', name: '秦芝味', short: '秦芝味' },
    { id: 'c-liqun', name: '立群', short: '立群' },
    { id: 'c-hangzhoumeishi', name: '航舟美时', short: '航舟美时' },
    { id: 'c-sujie', name: '苏杰', short: '苏杰' },
    { id: 'c-zhenglaisi', name: '蒸来思', short: '蒸来思' },
    { id: 'c-huochu', name: '霍厨', short: '霍厨' },
    { id: 'c-xianbaite', name: '鲜佰特', short: '鲜佰特' },
    { id: 'c-maitianxi', name: '麦田喜', short: '麦田喜' },
  ]

  const mk = (s: Partial<Sku> & Pick<Sku, 'id' | 'name' | 'shortName' | 'spec' | 'customerId'>): Sku => ({
    code: '',
    perBox: 12,
    boxL: 500,
    boxW: 340,
    boxH: 200,
    boxWeight: 8,
    boxColor: '#d99a5a',
    accentColor: '#3aa15c',
    textColor: '#ffffff',
    ...s,
  })

  const skus: Sku[] = [
    mk({
      id: 'sku-meat',
      name: '超合算 NB 鲜汁大肉包',
      shortName: '鲜汁大肉包',
      spec: '800克(10只)×8袋',
      customerId: CUSTOMER_HM,
      perBox: 8,
      boxL: 500,
      boxW: 335,
      boxH: 190,
      boxWeight: 7.2,
      accentColor: '#6b2f2a',
    }),
    mk({
      id: 'sku-green',
      name: '超合算 NB 翡翠香菇青菜包',
      shortName: '翡翠香菇青菜包',
      spec: '640克(8只)×12袋',
      customerId: CUSTOMER_HM,
      perBox: 12,
      boxL: 500,
      boxW: 340,
      boxH: 200,
      boxWeight: 8.2,
      accentColor: '#3aa15c',
    }),
    mk({
      id: 'sku-shaomai',
      name: '肉松咸蛋黄松仁 纸皮烧麦',
      shortName: '纸皮烧麦',
      spec: '240克×36盒',
      customerId: CUSTOMER_HM,
      perBox: 36,
      boxL: 465,
      boxW: 410,
      boxH: 235,
      boxWeight: 9.2,
      boxColor: '#f5b183',
      accentColor: '#f08a2a',
      textColor: '#ffffff',
    }),
    // ---- 快乐猴：箱规按外箱稿实测（外径，毫米） ----
    mk({
      id: 'sku-meat-klh',
      name: '快乐猴 80g 鲜汁大肉包',
      shortName: '鲜汁大肉包',
      spec: '800克(10只)×10袋',
      customerId: CUSTOMER_KLH,
      perBox: 10,
      boxL: 500,
      boxW: 340,
      boxH: 220,
      boxWeight: 8.6,
      accentColor: '#6b2f2a',
    }),
    mk({
      id: 'sku-green-klh',
      name: '快乐猴 80g 翡翠香菇大菜包',
      shortName: '翡翠香菇大菜包',
      spec: '640克(8只)×12袋',
      customerId: CUSTOMER_KLH,
      perBox: 12,
      boxL: 500,
      boxW: 340,
      boxH: 220,
      boxWeight: 8.2,
      accentColor: '#3aa15c',
    }),
    mk({
      id: 'sku-caitianzi-klh',
      name: '快乐猴 手作菜团子',
      shortName: '菜团子',
      spec: '600克(6只)×20袋',
      customerId: CUSTOMER_KLH,
      perBox: 20,
      boxL: 445,
      boxW: 350,
      boxH: 270,
      boxWeight: 12.5,
      boxColor: '#e8c88a',
      accentColor: '#c98a2e',
    }),
    mk({
      id: 'sku-jiaozi-klh',
      name: '快乐猴 20g 猪肉水饺',
      shortName: '水饺',
      nick: '饺子',
      spec: '2kg×6袋',
      customerId: CUSTOMER_KLH,
      perBox: 6,
      boxL: 430,
      boxW: 300,
      boxH: 230,
      boxWeight: 12.6,
      boxColor: '#dfe3ea',
      accentColor: '#4a6db5',
    }),
    mk({
      id: 'sku-nuomiji-klh',
      name: '快乐猴 手作荷香糯米鸡',
      shortName: '荷香糯米鸡',
      nick: '糯米鸡',
      spec: '600克×20袋',
      customerId: CUSTOMER_KLH,
      perBox: 20,
      boxL: 400,
      boxW: 345,
      boxH: 235,
      boxWeight: 12.5,
      accentColor: '#7a5c3a',
    }),
    mk({
      id: 'sku-meat-cyy',
      name: '鲜汁大肉包（菜洋洋）',
      shortName: '鲜汁大肉包',
      spec: '800克(10只)×8袋',
      customerId: CUSTOMER_CYY,
      perBox: 8,
      boxL: 500,
      boxW: 335,
      boxH: 190,
      boxWeight: 7.2,
      accentColor: '#6b2f2a',
    }),
    mk({ id: 'sku-zhongkouxian-1', name: '众口鲜150g荷香糯米鸡', shortName: '150g荷香糯米鸡', spec: '1*900g*12袋', customerId: 'c-zhongkouxian' }),
    mk({ id: 'sku-zhongkouxian-2', name: '众口鲜50g猪肉香菇烧麦', shortName: '50g猪肉香菇烧麦', spec: '1*1kg*10袋', customerId: 'c-zhongkouxian' }),
    mk({ id: 'sku-zhongkouxian-3', name: '众口鲜50g糯米烧麦', shortName: '50g糯米烧麦', spec: '1*1kg*10袋', customerId: 'c-zhongkouxian' }),
    mk({ id: 'sku-zhongkouxian-4', name: '众口鲜70g糯米烧麦', shortName: '70g糯米烧麦', spec: '1*1.4kg*10袋', customerId: 'c-zhongkouxian' }),
    mk({ id: 'sku-zhongkouxian-5', name: '众口鲜猪肉三鲜水饺', shortName: '猪肉三鲜水饺', spec: '1*2.5kg*2袋', customerId: 'c-zhongkouxian' }),
    mk({ id: 'sku-zhongkouxian-6', name: '众口鲜猪肉大葱水饺', shortName: '猪肉大葱水饺', spec: '1*2.5kg*2袋', customerId: 'c-zhongkouxian' }),
    mk({ id: 'sku-zhongkouxian-7', name: '众口鲜猪肉白菜水饺', shortName: '猪肉白菜水饺', spec: '1*2.5kg*2袋', customerId: 'c-zhongkouxian' }),
    mk({ id: 'sku-zhongkouxian-8', name: '众口鲜猪肉香菇水饺', shortName: '猪肉香菇水饺', spec: '1*2.5kg*2袋', customerId: 'c-zhongkouxian' }),
    mk({ id: 'sku-zhongkouxian-9', name: '众口鲜韭菜鸡蛋水饺', shortName: '韭菜鸡蛋水饺', spec: '1*2.5kg*2袋', customerId: 'c-zhongkouxian' }),
    mk({ id: 'sku-lengfeng-1', name: '冷丰50g腊肠烧麦', shortName: '50g腊肠烧麦', spec: '1*2.5kg*4袋', customerId: 'c-lengfeng' }),
    mk({ id: 'sku-lengfeng-2', name: '冷丰60g咸蛋黄纸皮烧麦', shortName: '60g咸蛋黄纸皮烧麦', spec: '1*2.5kg*4袋', customerId: 'c-lengfeng' }),
    mk({ id: 'sku-qiyao-1', name: '启肴80g招牌肉包', shortName: '80g招牌肉包', spec: '1*1.6kg*6袋', customerId: 'c-qiyao' }),
    mk({ id: 'sku-qiyao-2', name: '启肴80g梅干菜包', shortName: '80g梅干菜包', spec: '1*1.6kg*6袋', customerId: 'c-qiyao' }),
    mk({ id: 'sku-qiyao-3', name: '启肴80g豆沙包', shortName: '80g豆沙包', spec: '1*1.6kg*6袋', customerId: 'c-qiyao' }),
    mk({ id: 'sku-qiyao-4', name: '启肴80g香菇青菜包', shortName: '80g香菇青菜包', spec: '1*1.6kg*6袋', customerId: 'c-qiyao' }),
    mk({ id: 'sku-qiyao-5', name: '启肴80g香辣粉丝包', shortName: '80g香辣粉丝包', spec: '1*1.6kg*6袋', customerId: 'c-qiyao' }),
    mk({ id: 'sku-weierxian-1', name: '味儿鲜50g猪肉香菇烧麦', shortName: '50g猪肉香菇烧麦', spec: '1*1kg*10袋', customerId: 'c-weierxian' }),
    mk({ id: 'sku-duoyaxianxiang-1', name: '哆雅鲜享50g糯米烧麦', shortName: '50g糯米烧麦', spec: '1*1kg*10袋', customerId: 'c-duoyaxianxiang' }),
    mk({ id: 'sku-kenye-1', name: '垦野50g猪肉香菇烧麦', shortName: '50g猪肉香菇烧麦', spec: '1*500g*20袋', customerId: 'c-kenye' }),
    mk({ id: 'sku-waipodaren-1', name: '外婆大人70g肉汁烧麦', shortName: '70g肉汁烧麦', spec: '1*1.4kg*10袋', customerId: 'c-waipodaren' }),
    mk({ id: 'sku-tianhe-1', name: '天荷12g黑芝麻汤圆', shortName: '12g黑芝麻汤圆', spec: '1*200g*50袋', customerId: 'c-tianhe' }),
    mk({ id: 'sku-tianhe-2', name: '天荷55g流心豆沙包', shortName: '55g流心豆沙包', spec: '1*330g*30袋', customerId: 'c-tianhe' }),
    mk({ id: 'sku-tianhe-3', name: '天荷60g流心豆沙包', shortName: '60g流心豆沙包', spec: '1*360g*30袋', customerId: 'c-tianhe' }),
    mk({ id: 'sku-tianhe-4', name: '天荷黑猪肉虾仁水饺', shortName: '黑猪肉虾仁水饺', spec: '1*2.5kg*4袋', customerId: 'c-tianhe' }),
    mk({ id: 'sku-anfuchengxiang-1', name: '安福呈祥70g猪肉香菇烧麦', shortName: '70g猪肉香菇烧麦', spec: '1*3.5kg*4袋', customerId: 'c-anfuchengxiang' }),
    mk({ id: 'sku-xiaolongkan-1', name: '小龙坎25g火锅味老面小笼包', shortName: '25g火锅味老面小笼包', spec: '1*200g*40袋', customerId: 'c-xiaolongkan' }),
    mk({ id: 'sku-xiaolongkan-2', name: '小龙坎25g黑猪肉老面小笼包', shortName: '25g黑猪肉老面小笼包', spec: '1*200g*40袋', customerId: 'c-xiaolongkan' }),
    mk({ id: 'sku-xiaolongkan-3', name: '小龙坎50g糯米烧麦', shortName: '50g糯米烧麦', spec: '1*1kg*10袋', customerId: 'c-xiaolongkan' }),
    mk({ id: 'sku-xiaolongkan-4', name: '小龙坎50g糯米烧麦(香菇猪肉味)', shortName: '50g糯米烧麦(香菇猪肉味)', spec: '1*1kg*10袋', customerId: 'c-xiaolongkan' }),
    mk({ id: 'sku-chuanweijingzao-1', name: '川为精猪肉大葱水饺', shortName: '川为精猪肉大葱水饺', spec: '1*2.5kg*2袋', customerId: 'c-chuanweijingzao' }),
    mk({ id: 'sku-chuanweijingzao-2', name: '川为精猪肉白菜水饺', shortName: '川为精猪肉白菜水饺', spec: '1*2.5kg*2袋', customerId: 'c-chuanweijingzao' }),
    mk({ id: 'sku-chuanweijingzao-3', name: '川为精造16g猪肉大葱水饺', shortName: '16g猪肉大葱水饺', spec: '1*2.5kg*2袋', customerId: 'c-chuanweijingzao' }),
    mk({ id: 'sku-chuanweijingzao-4', name: '川为精造16g猪肉白菜水饺', shortName: '16g猪肉白菜水饺', spec: '1*2.5kg*2袋', customerId: 'c-chuanweijingzao' }),
    mk({ id: 'sku-chuanweijingzao-5', name: '川为精造16g韭菜鸡蛋水饺', shortName: '16g韭菜鸡蛋水饺', spec: '1*2.5kg*2袋', customerId: 'c-chuanweijingzao' }),
    mk({ id: 'sku-chuanweijingzao-6', name: '川为精造猪肉玉米水饺', shortName: '猪肉玉米水饺', spec: '1*2.5kg*2袋', customerId: 'c-chuanweijingzao' }),
    mk({ id: 'sku-chuanweijingzao-7', name: '川为精造猪肉韭菜水饺', shortName: '猪肉韭菜水饺', spec: '1*2.5kg*2袋', customerId: 'c-chuanweijingzao' }),
    mk({ id: 'sku-chuanweijingzao-8', name: '川为精造韭菜鸡蛋水饺', shortName: '韭菜鸡蛋水饺', spec: '1*2.5kg*2袋', customerId: 'c-chuanweijingzao' }),
    mk({ id: 'sku-chuanxiangong-1', name: '川鲜公20g猪肉大葱水饺', shortName: '20g猪肉大葱水饺', spec: '1*2.5kg*2袋', customerId: 'c-chuanxiangong' }),
    mk({ id: 'sku-chuanxiangong-2', name: '川鲜公20g猪肉玉米水饺', shortName: '20g猪肉玉米水饺', spec: '1*2.5kg*2袋', customerId: 'c-chuanxiangong' }),
    mk({ id: 'sku-chuanxiangong-3', name: '川鲜公20g猪肉白菜水饺', shortName: '20g猪肉白菜水饺', spec: '1*2.5kg*2袋', customerId: 'c-chuanxiangong' }),
    mk({ id: 'sku-chuanxiangong-4', name: '川鲜公20g猪肉韭菜水饺', shortName: '20g猪肉韭菜水饺', spec: '1*2.5kg*2袋', customerId: 'c-chuanxiangong' }),
    mk({ id: 'sku-chuanxiangong-5', name: '川鲜公50g猪肉香菇烧麦', shortName: '50g猪肉香菇烧麦', spec: '1*1kg*10袋', customerId: 'c-chuanxiangong' }),
    mk({ id: 'sku-chuanxiangong-6', name: '川鲜公猪肉大葱水饺', shortName: '猪肉大葱水饺', spec: '1*2.5kg*2袋', customerId: 'c-chuanxiangong' }),
    mk({ id: 'sku-chuanxiangong-7', name: '川鲜公猪肉玉米水饺', shortName: '猪肉玉米水饺', spec: '1*2.5kg*2袋', customerId: 'c-chuanxiangong' }),
    mk({ id: 'sku-laoxiansheng-1', name: '捞鲜生150g荷香糯米鸡', shortName: '150g荷香糯米鸡', spec: '1*900g*12袋', customerId: 'c-laoxiansheng' }),
    mk({ id: 'sku-xinyueyang-1', name: '欣悦阳50g猪肉香烧麦', shortName: '50g猪肉香烧麦', spec: '1*1kg*10袋', customerId: 'c-xinyueyang' }),
    mk({ id: 'sku-xinyueyang-2', name: '欣悦阳50g猪肉香菇烧麦', shortName: '50g猪肉香菇烧麦', spec: '1*1kg*10袋', customerId: 'c-xinyueyang' }),
    mk({ id: 'sku-xinyueyang-3', name: '欣悦阳70g猪肉香烧麦', shortName: '70g猪肉香烧麦', spec: '1*3.5kg*4袋', customerId: 'c-xinyueyang' }),
    mk({ id: 'sku-xinyueyang-4', name: '欣悦阳70g猪肉香菇烧麦', shortName: '70g猪肉香菇烧麦', spec: '1*3.5kg*4袋', customerId: 'c-xinyueyang' }),
    mk({ id: 'sku-hanjing-1', name: '汉景20g黑芝麻汤圆', shortName: '20g黑芝麻汤圆', spec: '1*2.5kg*4袋', customerId: 'c-hanjing' }),
    mk({ id: 'sku-piaochongxiansheng-1', name: '瓢虫鲜生12g黑芝麻汤圆', shortName: '12g黑芝麻汤圆', spec: '1*500g*20袋', customerId: 'c-piaochongxiansheng' }),
    mk({ id: 'sku-zhenshihui-1', name: '甄实惠12g黑芝麻汤圆', shortName: '12g黑芝麻汤圆', spec: '1*2.5kg*4袋', customerId: 'c-zhenshihui' }),
    mk({ id: 'sku-zhixianglai-1', name: '知享睐50g猪肉香烧麦', shortName: '50g猪肉香烧麦', spec: '1*1kg*10袋', customerId: 'c-zhixianglai' }),
    mk({ id: 'sku-shijian-1', name: '示剑12g黑芝麻汤圆', shortName: '12g黑芝麻汤圆', spec: '1*320g*30袋', customerId: 'c-shijian' }),
    mk({ id: 'sku-fuyunlitianxia-1', name: '福运立天下50g猪肉香烧麦', shortName: '50g猪肉香烧麦', spec: '1*1kg*10袋', customerId: 'c-fuyunlitianxia' }),
    mk({ id: 'sku-fuyunlitianxia-2', name: '福运立天下50g猪肉香菇烧麦', shortName: '50g猪肉香菇烧麦', spec: '1*1kg*10袋', customerId: 'c-fuyunlitianxia' }),
    mk({ id: 'sku-fuyunlitianxia-3', name: '福运立天下55g火腿玉米烧麦', shortName: '55g火腿玉米烧麦', spec: '1*1.1kg*10袋', customerId: 'c-fuyunlitianxia' }),
    mk({ id: 'sku-fuyunlitianxia-4', name: '福运立天下70g猪肉香菇烧麦', shortName: '70g猪肉香菇烧麦', spec: '1*1.05kg*10袋', customerId: 'c-fuyunlitianxia' }),
    mk({ id: 'sku-qinzhiwei-1', name: '秦芝味25g捞面小笼包', shortName: '25g捞面小笼包', spec: '1*200g*40袋', customerId: 'c-qinzhiwei' }),
    mk({ id: 'sku-qinzhiwei-2', name: '秦芝味25g黑猪肉小笼包', shortName: '25g黑猪肉小笼包', spec: '1*200g*40袋', customerId: 'c-qinzhiwei' }),
    mk({ id: 'sku-liqun-1', name: '立群12g黑芝麻汤圆', shortName: '12g黑芝麻汤圆', spec: '1*2.5kg*4袋', customerId: 'c-liqun' }),
    mk({ id: 'sku-liqun-2', name: '立群20g猪肉芹菜水饺', shortName: '20g猪肉芹菜水饺', spec: '1*2.5kg*4袋', customerId: 'c-liqun' }),
    mk({ id: 'sku-liqun-3', name: '立群50g梅干菜烧麦', shortName: '50g梅干菜烧麦', spec: '1*1kg*10袋', customerId: 'c-liqun' }),
    mk({ id: 'sku-liqun-4', name: '立群50g火腿玉米烧麦', shortName: '50g火腿玉米烧麦', spec: '1*1kg*10袋', customerId: 'c-liqun' }),
    mk({ id: 'sku-liqun-5', name: '立群50g猪肉香菇烧麦', shortName: '50g猪肉香菇烧麦', spec: '1*1kg*10袋', customerId: 'c-liqun' }),
    mk({ id: 'sku-liqun-6', name: '立群70g猪肉香菇烧麦', shortName: '70g猪肉香菇烧麦', spec: '1*1.4kg*10袋', customerId: 'c-liqun' }),
    mk({ id: 'sku-liqun-7', name: '立群70g肉汁烧麦', shortName: '70g肉汁烧麦', spec: '1*1.4kg*10袋', customerId: 'c-liqun' }),
    mk({ id: 'sku-liqun-8', name: '立群80g梅干菜包', shortName: '80g梅干菜包', spec: '1*800g*10袋', customerId: 'c-liqun' }),
    mk({ id: 'sku-liqun-9', name: '立群80g梅干菜包(橡果)', shortName: '80g梅干菜包(橡果)', spec: '1*800g*10袋', customerId: 'c-liqun' }),
    mk({ id: 'sku-liqun-10', name: '立群80g猪肉包', shortName: '80g猪肉包', spec: '1*800g*10袋', customerId: 'c-liqun' }),
    mk({ id: 'sku-liqun-11', name: '立群80g猪肉包(散装)', shortName: '80g猪肉包(散装)', spec: '1*8kg*1袋', customerId: 'c-liqun' }),
    mk({ id: 'sku-liqun-12', name: '立群80g猪肉包(橡果)', shortName: '80g猪肉包(橡果)', spec: '1*800g*10袋', customerId: 'c-liqun' }),
    mk({ id: 'sku-liqun-13', name: '立群80g香菇青菜包(橡果)', shortName: '80g香菇青菜包(橡果)', spec: '1*800g*10袋', customerId: 'c-liqun' }),
    mk({ id: 'sku-liqun-14', name: '立群猪肉玉米水饺', shortName: '猪肉玉米水饺', spec: '1*2.5kg*4袋', customerId: 'c-liqun' }),
    mk({ id: 'sku-liqun-15', name: '立群猪肉香菇水饺', shortName: '猪肉香菇水饺', spec: '1*2.5kg*4袋', customerId: 'c-liqun' }),
    mk({ id: 'sku-hangzhoumeishi-1', name: '航舟美时70g猪肉香烧麦', shortName: '70g猪肉香烧麦', spec: '1*1.4kg*10袋', customerId: 'c-hangzhoumeishi' }),
    mk({ id: 'sku-hangzhoumeishi-2', name: '航舟美时70g猪肉香菇烧麦', shortName: '70g猪肉香菇烧麦', spec: '1*1.4kg*10袋', customerId: 'c-hangzhoumeishi' }),
    mk({ id: 'sku-sujie-1', name: '苏杰50g糯米烧麦', shortName: '50g糯米烧麦', spec: '1*1kg*10袋', customerId: 'c-sujie' }),
    mk({ id: 'sku-cyy-1', name: '菜洋洋50g火腿玉米烧麦', shortName: '50g火腿玉米烧麦', spec: '1*1kg*10袋', customerId: 'c-cyy' }),
    mk({ id: 'sku-cyy-2', name: '菜洋洋55g纸皮烧麦', shortName: '55g纸皮烧麦', spec: '1*1.1kg*10袋', customerId: 'c-cyy' }),
    mk({ id: 'sku-cyy-3', name: '菜洋洋80g奥尔良鸡肉包', shortName: '80g奥尔良鸡肉包', spec: '1*800g*10袋', customerId: 'c-cyy' }),
    mk({ id: 'sku-cyy-4', name: '菜洋洋80g梅干菜包', shortName: '80g梅干菜包', spec: '1*800g*10袋', customerId: 'c-cyy' }),
    mk({ id: 'sku-cyy-5', name: '菜洋洋80g肉末粉丝包', shortName: '80g肉末粉丝包', spec: '1*800g*10袋', customerId: 'c-cyy' }),
    mk({ id: 'sku-cyy-6', name: '菜洋洋80g豆沙包', shortName: '80g豆沙包', spec: '1*800g*10袋', customerId: 'c-cyy' }),
    mk({ id: 'sku-cyy-7', name: '菜洋洋80g酱肉包', shortName: '80g酱肉包', spec: '1*800g*10袋', customerId: 'c-cyy' }),
    mk({ id: 'sku-cyy-8', name: '菜洋洋80g香菇青菜包', shortName: '80g香菇青菜包', spec: '1*800g*10袋', customerId: 'c-cyy' }),
    mk({ id: 'sku-cyy-9', name: '菜洋洋80g鲜汁肉包', shortName: '80g鲜汁肉包', spec: '1*800g*10袋', customerId: 'c-cyy' }),
    mk({ id: 'sku-cyy-10', name: '菜洋洋火腿玉米烧麦', shortName: '火腿玉米烧麦', spec: '1*1kg*10袋', customerId: 'c-cyy' }),
    mk({ id: 'sku-zhenglaisi-1', name: '蒸来思50g糯米烧麦', shortName: '50g糯米烧麦', spec: '1*1kg*10袋', customerId: 'c-zhenglaisi' }),
    mk({ id: 'sku-zhenglaisi-2', name: '蒸来思70g糯米烧麦', shortName: '70g糯米烧麦', spec: '1*3.5kg*4袋', customerId: 'c-zhenglaisi' }),
    mk({ id: 'sku-huochu-1', name: '霍厨50g糯米烧麦', shortName: '50g糯米烧麦', spec: '1*1kg*10袋', customerId: 'c-huochu' }),
    mk({ id: 'sku-huochu-2', name: '霍厨70g糯米烧麦', shortName: '70g糯米烧麦', spec: '1*3.5kg*4袋', customerId: 'c-huochu' }),
    mk({ id: 'sku-xianbaite-1', name: '鲜佰特50g猪肉香菇烧麦', shortName: '50g猪肉香菇烧麦', spec: '1*1kg*10袋', customerId: 'c-xianbaite' }),
    mk({ id: 'sku-maitianxi-1', name: '麦田喜50g火腿玉米烧麦', shortName: '50g火腿玉米烧麦', spec: '1*1kg*15袋', customerId: 'c-maitianxi' }),
    mk({ id: 'sku-maitianxi-2', name: '麦田喜50g猪肉香菇烧麦', shortName: '50g猪肉香菇烧麦', spec: '1*1kg*10袋', customerId: 'c-maitianxi' }),
  ]

  const batches: Batch[] = []
  const moves: Move[] = []

  // 不再预置示例库存：首次打开就是干净的空库存，由用户自己在「库存」页录入。
  return {
    customers,
    skus,
    batches,
    moves,
    orders: [],
    trucks: [{ id: uid(), name: '4.2米厢货', L: 4200, W: 2000, H: 2200, maxWeight: 2000 }],
    inboundRecords: [],
    seq: 1,
    version: DATA_VERSION,
  }
}

type LegacyPallet = { id?: string; no?: string; createdAt?: number; items?: { skuId: string; boxes: number }[] }
type LegacyOrder = Order & { customer?: string; pallets?: LegacyPallet[] }

function migrate(raw: Record<string, unknown>): DB {
  const base = seed()
  const data = raw as Partial<DB> & { orders?: LegacyOrder[] }

  const customers = (Array.isArray(data.customers) ? data.customers : []).filter((c) => c && typeof c === 'object' && c.id)
  const fallbackCustomer = customers[0]?.id ?? CUSTOMER_HM
  if (customers.length === 0) customers.push(...base.customers)

  // 品项：补齐新字段（客户、箱面配色、箱面大字）；顺带清掉历史上可能写入的空洞/空元素，避免后续 new Map 崩溃
  const rawSkus = (Array.isArray(data.skus) ? data.skus : base.skus).filter(
    (s) => s && typeof s === 'object' && s.id,
  ) as (Sku & Partial<Pick<Sku, 'customerId' | 'shortName' | 'boxColor' | 'accentColor' | 'textColor'>>)[]
  const skus: Sku[] = rawSkus.map((s) => ({
    ...s,
    customerId: s.customerId ?? fallbackCustomer,
    shortName: s.shortName ?? s.name,
    boxColor: s.boxColor ?? '#d99a5a',
    accentColor: s.accentColor ?? '#3aa15c',
    textColor: s.textColor ?? '#ffffff',
  }))

  // 批次：丢掉旧的 left 字段，余量一律由流水算
  const rawBatches = (Array.isArray(data.batches) ? data.batches : base.batches).filter(
    (b) => b && typeof b === 'object' && b.id,
  ) as (Batch & { left?: number })[]
  const batches: Batch[] = rawBatches.map((b) => ({
    id: b.id,
    skuId: b.skuId,
    batchNo: b.batchNo ?? b.prodDate?.replace(/-/g, '') ?? '无批次',
    qty: Number(b.qty) || 0,
    prodDate: b.prodDate ?? '',
    createdAt: Number(b.createdAt) || Date.now(),
  }))

  // 没有流水的老数据：按“入库总量 - 已发出”倒推，保证结转后的余量和以前一致
  let moves: Move[]
  if (Array.isArray(data.moves)) {
    moves = data.moves.filter((m) => m && typeof m === 'object' && m.id && m.skuId)
  } else {
    moves = []
    for (const b of rawBatches) {
      const at = Number(b.createdAt) || Date.now()
      const total = Number(b.qty) || 0
      const left = b.left
      if (total > 0) {
        moves.push({ id: uid(), at, type: 'in', skuId: b.skuId, batchId: b.id, qty: total, ref: '期初', note: '历史结转' })
      }
      if (typeof left !== 'number') continue
      const used = total - left
      if (used > 0) {
        moves.push({ id: uid(), at, type: 'out', skuId: b.skuId, batchId: b.id, qty: -used, ref: '期初', note: '历史已发' })
      } else if (used < 0) {
        moves.push({ id: uid(), at, type: 'adjust', skuId: b.skuId, batchId: b.id, qty: -used, ref: '期初', note: '历史盘盈' })
      }
    }
  }

  // 单据：旧版一块板上混放多个品项，新版一板一品，按品项拆开
  const srcOrders = (Array.isArray(data.orders) ? data.orders : []) as LegacyOrder[]
  const orders: Order[] = srcOrders.map((o) => {
    const pallets: Pallet[] = []
    for (const p of o.pallets ?? []) {
      if ('skuId' in p && p.skuId) {
        pallets.push(p as Pallet)
        continue
      }
      const legacy = p as LegacyPallet
      for (const it of legacy.items ?? []) {
        const batch = batches.find((b) => b.skuId === it.skuId)
        const boxes = Math.max(1, it.boxes)
        const layers = Math.ceil(boxes / DEFAULT_PER_LAYER)
        pallets.push({
          id: uid(),
          no: '',
          skuId: it.skuId,
          prodDate: batch?.prodDate ?? '',
          layers,
          perLayer: DEFAULT_PER_LAYER,
          topCount: boxes - (layers - 1) * DEFAULT_PER_LAYER,
          createdAt: Number(p.createdAt) || Date.now(),
        })
      }
    }
    return {
      ...o,
      destination: o.destination || o.customer || '未填收货地',
      // 旧版只有一个客户名字段，迁移时统一挂到默认客户上
      customerId: o.customerId || fallbackCustomer,
      pallets: pallets.map((p, i) => ({ ...p, no: `P${i + 1}` })),
    } as Order
  })

  // 车厢：旧数据用厘米，新数据统一用毫米
  const rawTrucks = data.trucks?.length ? data.trucks : base.trucks
  const trucks: Truck[] = rawTrucks.map((t) => ({
    ...t,
    L: t.L < 100 ? t.L * 10 : t.L,
    W: t.W < 100 ? t.W * 10 : t.W,
    H: t.H < 100 ? t.H * 10 : t.H,
  }))

  // 示例库存补齐：只补差额，不动已有单据和已经发出去的货
  const version = Number(data.version) || 1

  const leftOfBatch = new Map<string, number>()
  for (const m of moves) {
    if (!m.batchId || m.voided) continue
    leftOfBatch.set(m.batchId, (leftOfBatch.get(m.batchId) ?? 0) + m.qty)
  }
  const leftOfDate = (skuId: string, prodDate: string) => {
    let n = 0
    for (const b of batches) {
      if (b.skuId !== skuId || (b.prodDate || '') !== prodDate) continue
      n += leftOfBatch.get(b.id) ?? 0
    }
    return n
  }
  /** 把这个品这个日期补到 boxes 箱（按 perBox 折件），不够才补 */
  const topUp = (sku: Sku, prodDate: string, boxes: number, note: string) => {
    const need = boxes * (sku.perBox || 1) - leftOfDate(sku.id, prodDate)
    if (need <= 0) return
    let batch = batches.find((b) => b.skuId === sku.id && (b.prodDate || '') === prodDate)
    if (batch) {
      batch.qty += need
    } else {
      batch = { id: uid(), skuId: sku.id, batchNo: prodDate.replace(/-/g, ''), qty: need, prodDate, createdAt: Date.now() }
      batches.push(batch)
    }
    moves.push({ id: uid(), at: Date.now(), type: 'in', skuId: sku.id, batchId: batch.id, qty: need, ref: '示例补齐', note })
  }

  // v2：盒马每个品、每个生产日期补到 200 箱
  if (version < 2) {
    for (const sku of skus.filter((s) => s.customerId === CUSTOMER_HM)) {
      for (const back of HM_STOCK_DAYS) topUp(sku, daysAgo(back), HM_STOCK_BOXES, '盒马示例库存补到 200 箱/日期')
    }
  }

  // v3：快乐猴上新品（肉包 / 菜包 / 菜团子 / 饺子 / 糯米鸡），给老数据补上品项和示例库存
  if (version < 3) {
    for (const sku of base.skus.filter((s) => s.customerId === CUSTOMER_KLH)) {
      if (skus.some((x) => x.id === sku.id)) continue
      skus.push(sku)
    }
    // 老的快乐猴菜包箱规也按外箱稿校正
    const green = skus.find((x) => x.id === 'sku-green-klh')
    if (green) {
      green.name = '快乐猴 80g 翡翠香菇大菜包'
      green.shortName = '翡翠香菇大菜包'
      green.boxL = 500
      green.boxW = 340
      green.boxH = 220
    }
    for (const sku of skus.filter((s) => s.customerId === CUSTOMER_KLH)) {
      for (const back of KLH_STOCK_DAYS) topUp(sku, daysAgo(back), KLH_STOCK_BOXES, '快乐猴示例库存补齐')
    }
  }

  // v4：去掉所有示例库存（示例入库 / 示例补齐 的流水和它们对应的批次），
  // 首次打开变成干净的空库存，由用户在「库存」页录入真实数据。
  if (version < 4) {
    const demoMoveIds = new Set(moves.filter((m) => (m.note || '').includes('示例') || m.ref === '示例补齐').map((m) => m.id))
    // 找出只由示例流水组成的批次，一并清掉
    const demoBatchIds = new Set<string>()
    for (const b of batches) {
      const bs = moves.filter((m) => m.batchId === b.id && !m.voided)
      if (bs.length > 0 && bs.every((m) => demoMoveIds.has(m.id))) demoBatchIds.add(b.id)
    }
    for (let i = moves.length - 1; i >= 0; i--) {
      if (demoMoveIds.has(moves[i].id)) moves.splice(i, 1)
    }
    for (let i = batches.length - 1; i >= 0; i--) {
      if (demoBatchIds.has(batches[i].id)) batches.splice(i, 1)
    }
  }

  // v5：按「2026 年成品冷库生产入库登记表」补充收货方和品项。
  // 只补品项和收货方定义，不补库存（库存由用户自己录入 / 导入），也不动已有单据。
  if (version < 5) {
    for (const c of base.customers) {
      if (customers.some((x) => x.id === c.id)) continue
      customers.push(c)
    }
    for (const sku of base.skus) {
      if (skus.some((x) => x.id === sku.id)) continue
      skus.push(sku)
    }
  }

  return {
    customers,
    skus,
    batches,
    moves,
    orders,
    trucks,
    inboundRecords: Array.isArray(data.inboundRecords) ? data.inboundRecords : [],
    seq: data.seq ?? 1,
    version: DATA_VERSION,
  }
}

function readLocal(): DB | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    return migrate(JSON.parse(raw))
  } catch {
    return null
  }
}

/* ---------- 持久化：浏览器数据库（IndexedDB）为主，localStorage 兜底 ---------- */

const IDB_NAME = 'inventrack'
const IDB_STORE = 'kv'
const IDB_KEY = 'db'

export type StorageMode = 'idb' | 'local'

export type StorageInfo = {
  /** idb = 浏览器数据库（容量按手机剩余空间算）；local = 老式缓存（约 5MB 封顶） */
  mode: StorageMode
  ready: boolean
  /** 写入失败等异常信息，空字符串表示正常 */
  error: string
  /** 当前数据字符数 */
  chars: number
  /** 最近一次落盘时间 */
  savedAt: number
  /** 浏览器是否同意了“长期保留数据” */
  persisted: boolean
}

let info: StorageInfo = { mode: 'local', ready: false, error: '', chars: 0, savedAt: 0, persisted: false }
const infoListeners = new Set<() => void>()
const emitInfo = () => {
  info = { ...info }
  infoListeners.forEach((fn) => fn())
}

let idb: IDBDatabase | null = null

function openIdb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(IDB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

function idbGet(key: string): Promise<unknown> {
  return new Promise((resolve) => {
    if (!idb) return resolve(null)
    try {
      const req = idb.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

function idbSet(key: string, value: unknown): Promise<boolean> {
  return new Promise((resolve) => {
    if (!idb) return resolve(false)
    try {
      const tx = idb.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put(value, key)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
      tx.onabort = () => resolve(false)
    } catch {
      resolve(false)
    }
  })
}

let state: DB = seed()
const listeners = new Set<() => void>()

/** 启动时调用一次：把数据从磁盘读回内存，并完成 localStorage → IndexedDB 的迁移 */
export async function initStore() {
  const local = readLocal()
  const db = await openIdb()

  if (db) {
    idb = db
    info.mode = 'idb'
    const stored = await idbGet(IDB_KEY)
    if (stored && typeof stored === 'object') {
      state = migrate(stored as Record<string, unknown>)
      // 迁移结果立刻落盘：像「补库存」这种一次性动作靠 version 标记，重跑就会重复补
      await idbSet(IDB_KEY, state)
    } else if (local) {
      state = local
      await idbSet(IDB_KEY, local)
    } else {
      state = seed()
      await idbSet(IDB_KEY, state)
    }
    // 迁移完成，删掉 localStorage 里的旧副本，免得两份各占一份配额
    try {
      localStorage.removeItem(KEY)
    } catch {
      /* 忽略 */
    }
  } else {
    state = local ?? seed()
    info.mode = 'local'
    if (!local) info.error = '这台手机的浏览器不支持数据库，已退回缓存模式，容量有限'
    else {
      // localStorage 里的老数据也带上了迁移结果，写回去免得下次再补一遍
      try {
        localStorage.setItem(KEY, JSON.stringify(state))
      } catch {
        /* 忽略 */
      }
    }
  }

  info.chars = JSON.stringify(state).length
  info.ready = true
  emitInfo()
  listeners.forEach((fn) => fn())

  // 申请“长期保留”，降低被浏览器当缓存清掉的可能（Chrome 静默同意，Safari 不支持）
  // 注意：不能 await，某些浏览器会弹权限提示，会卡住首屏渲染
  void (async () => {
    try {
      if (navigator.storage?.persist) {
        info.persisted = await navigator.storage.persist()
        emitInfo()
      }
    } catch {
      /* 忽略 */
    }
  })()
}

let timer: ReturnType<typeof setTimeout> | null = null
let writing = false
let pendingWrite = false

function schedulePersist() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void persist()
  }, 120)
}

async function persist() {
  const data = state
  info.chars = JSON.stringify(data).length

  if (info.mode === 'idb') {
    if (writing) {
      pendingWrite = true
      return
    }
    writing = true
    info = { ...info, error: '' }
    const ok = await idbSet(IDB_KEY, data)
    writing = false
    if (!ok) {
      info = { ...info, error: '写入失败，请立即去「我的」导出备份' }
      emitInfo()
      return
    }
    info.savedAt = Date.now()
    emitInfo()
    if (pendingWrite) {
      pendingWrite = false
      void persist()
    }
    return
  }

  try {
    localStorage.setItem(KEY, JSON.stringify(data))
    info.savedAt = Date.now()
    info = { ...info, error: '' }
  } catch {
    info = { ...info, error: '存储已满，写入失败，请立即去「我的」导出备份' }
  }
  emitInfo()
}

export function flush() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  void persist()
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}

function commit(next: DB) {
  state = next
  schedulePersist()
  listeners.forEach((fn) => fn())
}

export function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function subscribeInfo(fn: () => void) {
  infoListeners.add(fn)
  return () => {
    infoListeners.delete(fn)
  }
}

export const getState = () => state
export const useDB = () => useSyncExternalStore(subscribe, getState, getState)

export const getInfo = () => info
export const useStorageInfo = () => useSyncExternalStore(subscribeInfo, getInfo, getInfo)

export function replaceAll(next: DB) {
  commit(migrate(next as unknown as Record<string, unknown>))
}

export function resetAll() {
  commit(seed())
}

/* ---------- 客户 ---------- */

export function saveCustomer(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return ''
  const id = uid()
  commit({ ...state, customers: [...state.customers, { id, name: trimmed, short: trimmed }] })
  return id
}

export function updateCustomer(id: string, name: string) {
  const trimmed = name.trim()
  if (!trimmed) return false
  commit({
    ...state,
    customers: state.customers.map((c) => (c.id === id ? { ...c, name: trimmed, short: trimmed } : c)),
  })
  return true
}

export function removeCustomer(id: string) {
  if (state.skus.some((s) => s.customerId === id)) return false
  commit({ ...state, customers: state.customers.filter((c) => c.id !== id) })
  return true
}

/* ---------- 品项 ---------- */

export function saveSku(input: Omit<Sku, 'id'> & { id?: string }) {
  const id = input.id ?? uid()
  const sku: Sku = { ...input, id }
  const exists = state.skus.some((s) => s.id === id)
  commit({
    ...state,
    skus: exists ? state.skus.map((s) => (s.id === id ? sku : s)) : [sku, ...state.skus],
  })
  return id
}

export function removeSku(id: string) {
  commit({
    ...state,
    skus: state.skus.filter((s) => s.id !== id),
    batches: state.batches.filter((b) => b.skuId !== id),
    moves: state.moves.filter((m) => m.skuId !== id),
  })
}

/* ---------- 库存流水 ---------- */

function pushMove(db: DB, move: Omit<Move, 'id' | 'at'> & { at?: number }): Move[] {
  const m: Move = { ...move, id: uid(), at: move.at ?? Date.now() }
  return [m, ...db.moves]
}

/** 入库：建一个批次，同时记一条入账流水 */
export function addBatch(input: { skuId: string; qty: number; prodDate: string; batchNo?: string; note?: string }) {
  if (!(input.qty > 0)) return ''
  const batch: Batch = {
    id: uid(),
    skuId: input.skuId,
    batchNo: input.batchNo || input.prodDate.replace(/-/g, '') || '无批次',
    qty: input.qty,
    prodDate: input.prodDate,
    createdAt: Date.now(),
  }
  commit({
    ...state,
    batches: [batch, ...state.batches],
    moves: pushMove(state, {
      type: 'in',
      skuId: input.skuId,
      batchId: batch.id,
      qty: input.qty,
      ref: '入库',
      note: input.note ?? '手工入库',
    }),
  })
  return batch.id
}

/** 从 Excel 入库表导入的一行 */
export type InboundRow = {
  /** 品名（按它匹配 sku，匹配不到就新建） */
  name: string
  /** 规格，如 1*800g*10袋 */
  spec: string
  /** 数量（件=箱，直接当箱数） */
  qty: number
  /** 生产日期 YYYY-MM-DD */
  prodDate: string
  /** 入库日期（原表的「日期」列，仅展示用，不参与库存） */
  date?: string
}

/**
 * 批量导入入库：按品名匹配已有 sku（同名就复用），没有则新建一个最简 sku；
 * 每一行按「品名 + 生产日期」建/补一个批次，并记一条入账流水。
 * 同时把这次导入留档成一条「入库登记表」记录。
 * 全部在一个 commit 里完成，避免逐行提交刷屏。
 */
export function importInbound(
  rows: InboundRow[],
  opts: { fileName?: string } = {},
): { added: number; skusCreated: number; skipped: number } {
  let skusCreated = 0
  let added = 0
  let skipped = 0

  // 先在当前 skus 上做一层「同名缓存」，同名品项只建一次
  const nameIndex = new Map<string, string>() // name(小写去空格) -> skuId
  for (const s of state.skus) nameIndex.set(normName(s.name), s.id)

  let nextSkus = state.skus
  let nextBatches = state.batches
  let nextMoves = state.moves

  const push = (m: Omit<Move, 'id' | 'at'>) => {
    nextMoves = [{ ...m, id: uid(), at: Date.now() }, ...nextMoves]
  }

  const recordLines: { name: string; spec: string; prodDate: string; qty: number }[] = []

  for (const r of rows) {
    if (!(r.qty > 0)) {
      skipped++
      continue
    }
    const key = normName(r.name)
    let skuId = nameIndex.get(key)
    if (!skuId) {
      // 新建一个最简 sku，规格取导入的规格，其余用默认值
      const sku: Sku = {
        id: uid(),
        code: '',
        name: r.name,
        customerId: '',
        spec: r.spec || '',
        shortName: r.name,
        perBox: 12,
        boxL: 500,
        boxW: 340,
        boxH: 200,
        boxWeight: 8,
        boxColor: '#d99a5a',
        accentColor: '#3aa15c',
        textColor: '#ffffff',
      }
      nextSkus = [sku, ...nextSkus]
      nameIndex.set(key, sku.id)
      skuId = sku.id
      skusCreated++
    }

    // 找同 sku + 同生产日期的批次，没有就建一个
    let batch = nextBatches.find((b) => b.skuId === skuId && b.prodDate === r.prodDate)
    if (!batch) {
      batch = {
        id: uid(),
        skuId,
        batchNo: r.prodDate.replace(/-/g, '') || '无批次',
        qty: r.qty,
        prodDate: r.prodDate,
        createdAt: Date.now(),
      }
      nextBatches = [batch, ...nextBatches]
    } else {
      nextBatches = nextBatches.map((b) => (b.id === batch!.id ? { ...b, qty: b.qty + r.qty } : b))
    }

    push({ type: 'in', skuId, batchId: batch.id, qty: r.qty, ref: 'Excel导入', note: `入库(${r.prodDate})` })
    recordLines.push({ name: r.name, spec: r.spec, prodDate: r.prodDate, qty: r.qty })
    added++
  }

  // 留档成一条入库登记表记录
  const record: InboundRecord = {
    id: uid(),
    fileName: opts.fileName || '未命名文件',
    at: Date.now(),
    rows: added,
    skusCreated,
    lines: recordLines,
  }

  commit({ ...state, skus: nextSkus, batches: nextBatches, moves: nextMoves, inboundRecords: [record, ...state.inboundRecords] })
  return { added, skusCreated, skipped }
}

function normName(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, '')
}

/** 退货 / 补货：往已有批次里加数量 */
export function returnToBatch(batchId: string, qty: number, note = '退货入库') {
  const batch = state.batches.find((b) => b.id === batchId)
  if (!batch || !(qty > 0)) return
  commit({
    ...state,
    batches: state.batches.map((b) => (b.id === batchId ? { ...b, qty: b.qty + qty } : b)),
    moves: pushMove(state, {
      type: 'return',
      skuId: batch.skuId,
      batchId,
      qty,
      ref: '退货',
      note,
    }),
  })
}

/** 盘点：把某批次调成实际数量，差额记一笔调整流水 */
export function adjustBatch(batchId: string, actual: number, note = '盘点调整') {
  const batch = state.batches.find((b) => b.id === batchId)
  if (!batch) return
  const current = batchLeft(state, batchId)
  const diff = Math.round(actual) - current
  if (diff === 0) return
  commit({
    ...state,
    moves: pushMove(state, {
      type: 'adjust',
      skuId: batch.skuId,
      batchId,
      qty: diff,
      ref: '盘点',
      note: `${note}（账面 ${current} → 实盘 ${Math.round(actual)}）`,
    }),
  })
}

/** 删除批次：连同它的流水一起删掉（等于这批货从账上消失） */
export function removeBatch(id: string) {
  commit({
    ...state,
    batches: state.batches.filter((b) => b.id !== id),
    moves: state.moves.filter((m) => m.batchId !== id),
  })
}

/* ---------- 车次 ---------- */

/** 计划行规范化：丢掉没填全的，同品同日期合并箱数 */
export function normalizePlan(lines: PlanLine[] | undefined): PlanLine[] {
  const map = new Map<string, PlanLine>()
  for (const l of lines ?? []) {
    if (!l.skuId || !l.prodDate || !(l.boxes > 0)) continue
    const key = `${l.skuId}|${l.prodDate}`
    const boxes = Math.round(l.boxes)
    const cur = map.get(key)
    if (cur) cur.boxes += boxes
    else map.set(key, { id: l.id || uid(), skuId: l.skuId, prodDate: l.prodDate, boxes })
  }
  // 保持录入顺序：用户先填哪行，对账卡片和装板顺序就按哪行来
  return [...map.values()]
}

export function createOrder(input: {
  destination: string
  customerId: string
  remark?: string
  plan?: PlanLine[]
}) {
  const d = new Date()
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const order: Order = {
    id: uid(),
    no: `FH${ymd}-${String(state.seq).padStart(3, '0')}`,
    destination: input.destination.trim() || '未填收货地',
    customerId: input.customerId,
    remark: input.remark ?? '',
    createdAt: Date.now(),
    status: 'draft',
    pallets: [],
    plan: normalizePlan(input.plan),
  }
  commit({ ...state, orders: [order, ...state.orders], seq: state.seq + 1 })
  return order.id
}

export function updateOrder(id: string, patch: Partial<Order>) {
  commit({ ...state, orders: state.orders.map((o) => (o.id === id ? { ...o, ...patch } : o)) })
}

export function removeOrder(id: string) {
  commit({ ...state, orders: state.orders.filter((o) => o.id !== id) })
}

/* ---------- 拖板 ---------- */

export function addPallet(orderId: string, input: Omit<Pallet, 'id' | 'no' | 'createdAt'>) {
  const id = uid()
  commit({
    ...state,
    orders: state.orders.map((o) => {
      if (o.id !== orderId) return o
      const pallet: Pallet = {
        ...input,
        id,
        no: `P${o.pallets.length + 1}`,
        createdAt: Date.now(),
      }
      return { ...o, pallets: [...o.pallets, pallet] }
    }),
  })
  return id
}

export function updatePallet(orderId: string, palletId: string, patch: Partial<Omit<Pallet, 'id'>>) {
  commit({
    ...state,
    orders: state.orders.map((o) => {
      if (o.id !== orderId) return o
      return { ...o, pallets: o.pallets.map((p) => (p.id === palletId ? { ...p, ...patch } : p)) }
    }),
  })
}

export function removePallet(orderId: string, palletId: string) {
  commit({
    ...state,
    orders: state.orders.map((o) => {
      if (o.id !== orderId) return o
      const pallets = o.pallets.filter((p) => p.id !== palletId).map((p, i) => ({ ...p, no: `P${i + 1}` }))
      return { ...o, pallets }
    }),
  })
}

export function movePallet(orderId: string, palletId: string, dir: -1 | 1) {
  commit({
    ...state,
    orders: state.orders.map((o) => {
      if (o.id !== orderId) return o
      const idx = o.pallets.findIndex((p) => p.id === palletId)
      const to = idx + dir
      if (idx < 0 || to < 0 || to >= o.pallets.length) return o
      const pallets = [...o.pallets]
      const [moved] = pallets.splice(idx, 1)
      pallets.splice(to, 0, moved)
      return { ...o, pallets: pallets.map((p, i) => ({ ...p, no: `P${i + 1}` })) }
    }),
  })
}

/** 这车货每个“品项 + 生产日期”要出多少箱 */
export function needByDate(order: Order) {
  const map = new Map<string, { skuId: string; prodDate: string; boxes: number }>()
  for (const p of order.pallets) {
    const key = `${p.skuId}|${p.prodDate}`
    const cur = map.get(key)
    if (cur) cur.boxes += palletBoxes(p)
    else map.set(key, { skuId: p.skuId, prodDate: p.prodDate, boxes: palletBoxes(p) })
  }
  return [...map.values()]
}

/** 这车货每个品项要出多少箱（不分日期） */
export function needOf(order: Order) {
  const need = new Map<string, number>()
  for (const p of order.pallets) {
    need.set(p.skuId, (need.get(p.skuId) ?? 0) + palletBoxes(p))
  }
  return need
}

/** 这个「品 + 生产日期」计划要发多少箱 */
export function plannedBoxes(order: Order, skuId: string, prodDate: string) {
  return (order.plan ?? [])
    .filter((l) => l.skuId === skuId && l.prodDate === prodDate)
    .reduce((s, l) => s + l.boxes, 0)
}

/** 这个「品 + 生产日期」已经装了多少箱（可排除正在改的那一板） */
export function loadedBoxes(order: Order, skuId: string, prodDate: string, exceptId?: string) {
  return order.pallets
    .filter((p) => p.skuId === skuId && p.prodDate === prodDate && p.id !== exceptId)
    .reduce((s, p) => s + palletBoxes(p), 0)
}

/** 计划对账：每行计划多少 / 已装多少 / 还差多少，外加计划外装了什么 */
export function planSummary(order: Order) {
  const rest = new Map<string, number>()
  for (const p of order.pallets) {
    const key = `${p.skuId}|${p.prodDate}`
    rest.set(key, (rest.get(key) ?? 0) + palletBoxes(p))
  }
  const lines = (order.plan ?? []).map((l) => {
    const key = `${l.skuId}|${l.prodDate}`
    const done = rest.get(key) ?? 0
    rest.delete(key)
    return { ...l, done, left: l.boxes - done }
  })
  // 剩下的都是「计划里没写、却装上去了」的货，得显性化
  const extra = [...rest.entries()].map(([key, boxes]) => {
    const [skuId, prodDate] = key.split('|')
    return { skuId, prodDate, boxes }
  })
  return {
    lines,
    extra,
    planBoxes: lines.reduce((s, l) => s + l.boxes, 0),
    doneBoxes: lines.reduce((s, l) => s + Math.min(l.done, l.boxes), 0),
    leftBoxes: lines.reduce((s, l) => s + Math.max(0, l.left), 0),
    overBoxes: lines.reduce((s, l) => s + Math.max(0, -l.left), 0),
    extraBoxes: extra.reduce((s, l) => s + l.boxes, 0),
  }
}

/** 发车前对账：某个品项某个日期够不够（按生产日期要货，就不能从别的日期挪） */
export function shortages(db: DB, order: Order) {
  const out: { sku: Sku; prodDate: string; need: number; have: number; short: number }[] = []
  for (const line of needByDate(order)) {
    const sku = db.skus.find((s) => s.id === line.skuId)
    if (!sku) continue
    const need = line.boxes * (sku.perBox || 1)
    const have = stockOfDate(db, line.skuId, line.prodDate)
    if (need > have) out.push({ sku, prodDate: line.prodDate, need, have, short: need - have })
  }
  return out
}

/**
 * 确认发车：按“品项 + 生产日期”汇总箱数，折成件数后从该日期的批次里先进先出扣。
 * 扣减不是改数字，而是给每个被吃到的批次记一笔负数流水。
 */
export function shipOrder(id: string) {
  const order = state.orders.find((o) => o.id === id)
  if (!order || order.status === 'shipped') return

  const newMoves: Move[] = []

  for (const line of needByDate(order)) {
    const sku = state.skus.find((s) => s.id === line.skuId)
    let remain = line.boxes * (sku?.perBox || 1)

    const pool = state.batches
      .filter((b) => b.skuId === line.skuId && b.prodDate === line.prodDate)
      .map((b) => ({ batch: b, left: batchLeft(state, b.id) }))
      .filter((x) => x.left > 0)
      .sort((a, b) => a.batch.createdAt - b.batch.createdAt)

    for (const { batch, left } of pool) {
      if (remain <= 0) break
      const take = Math.min(left, remain)
      remain -= take
      newMoves.push({
        id: uid(),
        at: Date.now(),
        type: 'out',
        skuId: line.skuId,
        batchId: batch.id,
        qty: -take,
        ref: order.no,
        note: `发车出库(${line.prodDate})`,
      })
    }

    // 这个日期的货不够：记一笔无批次的负数流水，把缺口显性化，方便事后补
    if (remain > 0) {
      newMoves.push({
        id: uid(),
        at: Date.now(),
        type: 'out',
        skuId: line.skuId,
        batchId: '',
        qty: -remain,
        ref: order.no,
        note: `库存不足，超发(${line.prodDate})`,
      })
    }
  }

  commit({
    ...state,
    moves: [...newMoves.reverse(), ...state.moves],
    orders: state.orders.map((o) => (o.id === id ? { ...o, status: 'shipped' } : o)),
  })
}

/** 撤销发车：把这单的出库流水逐条反向记回去，单据退回未发车 */
export function unshipOrder(id: string) {
  const order = state.orders.find((o) => o.id === id)
  if (!order || order.status !== 'shipped') return

  const outs = state.moves.filter((m) => m.type === 'out' && m.ref === order.no && !m.voided)
  if (outs.length === 0) return

  const back: Move[] = outs.map((m) => ({
    id: uid(),
    at: Date.now(),
    type: 'return',
    skuId: m.skuId,
    batchId: m.batchId,
    qty: -m.qty,
    ref: order.no,
    note: '撤销发车，库存回补',
  }))

  const reversed = new Set(outs.map((m) => m.id))

  commit({
    ...state,
    moves: [...back, ...state.moves.map((m) => (reversed.has(m.id) ? { ...m, voided: true } : m))],
    orders: state.orders.map((o) => (o.id === id ? { ...o, status: 'draft' } : o)),
  })
}

/* ---------- 车厢 ---------- */

export function saveTruck(t: Omit<Truck, 'id'> & { id?: string }) {
  const id = t.id ?? uid()
  const truck: Truck = { ...t, id }
  const exists = state.trucks.some((x) => x.id === id)
  commit({
    ...state,
    trucks: exists ? state.trucks.map((x) => (x.id === id ? truck : x)) : [...state.trucks, truck],
  })
}

/* ---------- 查询 ---------- */

export const skuById = (skus: Sku[], id: string) => skus.find((s) => s.id === id)

export function skusOfCustomer(db: DB, customerId: string) {
  return db.skus.filter((s) => s.customerId === customerId)
}

export function customerById(db: DB, id: string) {
  return db.customers.find((c) => c.id === id)
}

type Projection = { bySku: Map<string, number>; byBatch: Map<string, number> }
let projFor: DB | null = null
let proj: Projection = { bySku: new Map(), byBatch: new Map() }

/** 把全部流水累加成“每个品项、每个批次还剩多少”。按数据对象缓存，一次改动只算一遍 */
function project(db: DB): Projection {
  if (projFor === db) return proj
  const bySku = new Map<string, number>()
  const byBatch = new Map<string, number>()
  for (const m of db.moves) {
    bySku.set(m.skuId, (bySku.get(m.skuId) ?? 0) + m.qty)
    if (m.batchId) byBatch.set(m.batchId, (byBatch.get(m.batchId) ?? 0) + m.qty)
  }
  projFor = db
  proj = { bySku, byBatch }
  return proj
}

export const batchLeft = (db: DB, batchId: string) => project(db).byBatch.get(batchId) ?? 0
export const stockOf = (db: DB, skuId: string) => project(db).bySku.get(skuId) ?? 0

/** 某品项还有货的批次，按入库先后排（先进先出用这个顺序） */
export function batchesOf(db: DB, skuId: string) {
  return db.batches
    .filter((b) => b.skuId === skuId)
    .map((batch) => ({ batch, left: batchLeft(db, batch.id) }))
    .filter((x) => x.left > 0)
    .sort((a, b) => a.batch.createdAt - b.batch.createdAt)
}

/** 某品项按生产日期还剩多少，日期从新到旧 */
export function stockByDate(db: DB, skuId: string) {
  const map = new Map<string, number>()
  for (const { batch, left } of batchesOf(db, skuId)) {
    const d = batch.prodDate || '未填日期'
    map.set(d, (map.get(d) ?? 0) + left)
  }
  return [...map.entries()]
    .map(([prodDate, left]) => ({ prodDate, left }))
    .sort((a, b) => b.prodDate.localeCompare(a.prodDate))
}

/** 某品项某个生产日期还剩多少 */
export function stockOfDate(db: DB, skuId: string, prodDate: string) {
  return batchesOf(db, skuId)
    .filter((x) => (x.batch.prodDate || '未填日期') === prodDate)
    .reduce((s, x) => s + x.left, 0)
}

/** 某品项最近的库存流水 */
export function movesOf(db: DB, skuId: string, limit = 12) {
  return db.moves.filter((m) => m.skuId === skuId).slice(0, limit)
}

/** 今日入库 / 出库箱数（退货算入，调整按正负各归一边；已撤销的流水不计） */
export function todayFlow(db: DB) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const perOf = new Map(db.skus.filter((s) => s && s.id).map((s) => [s.id, s.perBox > 0 ? s.perBox : 1]))
  let inBoxes = 0
  let outBoxes = 0
  for (const m of db.moves) {
    if (m.at < start.getTime() || m.voided) continue
    const per = perOf.get(m.skuId) ?? 1
    if (m.qty > 0) inBoxes += m.qty / per
    else outBoxes += -m.qty / per
  }
  return { inBoxes: Math.round(inBoxes * 10) / 10, outBoxes: Math.round(outBoxes * 10) / 10 }
}

export function findByCode(db: DB, code: string) {
  const c = code.trim()
  if (!c) return undefined
  return db.skus.find((s) => s.code === c) ?? db.skus.find((s) => s.code.endsWith(c) || c.endsWith(s.code))
}
