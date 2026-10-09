/** 将生成的高考词表 JSON 适配为前端词条数据。 */
import type { VocabItem } from '../types';
import raw from './gaokao3500.generated.json';

type GaokaoBundle = {
  dataVersion: number;
  entries: VocabItem[];
};

const bundle = raw as GaokaoBundle;

/** 与 gaokao3500.generated.json 中 dataVersion 一致；更新词表后 bump 并重新运行 build 脚本 */
export const GAOKAO3500_DATA_VERSION = bundle.dataVersion;

export const GAOKAO3500_ENTRIES: readonly VocabItem[] = bundle.entries ?? [];
