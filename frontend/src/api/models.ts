import type { ModelOptionsResponse } from '@shared/types/index'

// TODO: GET /models/:code/options 실연결

const MOCK_PV5: ModelOptionsResponse = {
  model: {
    code: 'PV5',
    name: 'PV5 오픈베드',
    trims: [
      {
        key: 'basic',
        label: '베이직',
        sub_label: '기본 사양',
        base_price: 0, // placeholder — DB 확정 후 반영
        description: '기본 적재 사양. 표준 도어·기본 내장. (포함 옵션 목록은 확정 후 표시)',
      },
      {
        key: 'plus',
        label: '플러스',
        sub_label: '편의사양 추가',
        base_price: 0, // placeholder
        description: '베이직 + 편의·안전 사양 추가. (차이 항목은 옵션 확정 후 표시)',
      },
    ],
    option_groups: [
      {
        key: 'cargo_type',
        label: '적재함 유형',
        type: 'segment',
        values: [
          { key: 'insulated', label: '내장', price_delta: 0 },
          { key: 'frozen', label: '냉동', price_delta: 0 }, // placeholder
        ],
        default_key: 'insulated',
      },
      {
        key: 'top_size',
        label: '탑 크기',
        type: 'segment',
        values: [
          { key: 'low', label: '저상', price_delta: 0 },
          { key: 'standard', label: '표준', price_delta: 0 },
          { key: 'custom', label: '커스텀', price_delta: 0 }, // 치수 입력 → 추후
        ],
        default_key: 'low',
      },
      {
        key: 'door_type',
        label: '도어 종류',
        type: 'segment',
        values: [
          { key: 'swing', label: '여닫이', price_delta: 0 },
          { key: 'sliding', label: '슬라이딩', price_delta: 0 }, // placeholder
        ],
        default_key: 'swing',
      },
      {
        key: 'door_extra',
        label: '도어 추가',
        type: 'segment',
        values: [
          { key: 'none', label: '없음', price_delta: 0 },
          { key: 'driver_side', label: '운전석방향', price_delta: 0 }, // placeholder
        ],
        default_key: 'none',
      },
      {
        key: 'thermometer',
        label: '온도기록계',
        type: 'segment',
        values: [
          { key: 'yes', label: '설치(O)', price_delta: 0 },  // placeholder
          { key: 'no', label: '미설치(X)', price_delta: 0 },
        ],
        default_key: 'no',
      },
      {
        key: 'partition',
        label: '격벽',
        type: 'segment',
        values: [
          { key: 'none', label: '없음', price_delta: 0 },
          { key: 'net', label: '그물망', price_delta: 0 },        // placeholder
          { key: 'frozen', label: '냉동격벽', price_delta: 0 },  // placeholder
        ],
        default_key: 'none',
      },
    ],
  },
}

export async function fetchModelOptions(code: string): Promise<ModelOptionsResponse> {
  // TODO: return fetch(`/api/models/${code}/options`).then(r => r.json())
  await new Promise(r => setTimeout(r, 0))
  if (code === 'PV5') return MOCK_PV5
  throw new Error(`Unknown model code: ${code}`)
}
