#!/usr/bin/env python3
"""
계약서 양식에 **커스텀 특장 옵션** 두 칸을 넣는다.

특장 사양표 마지막 줄(온도기록계)의 오른쪽 두 칸이 비어 있다. 거기에
라벨칸 `{{spec_custom_label}}`, 값칸 `{{spec_custom}}` 을 넣는다.

- 라벨칸 서식은 같은 표의 **라벨칸(c0)** 에서, 값칸 서식은 **값칸(c1)** 에서 복제한다.
  새로 만들면 글꼴·정렬이 그 칸만 달라진다.
- 한 번 더 돌려도 안전하다(이미 있으면 건드리지 않는다).

    python3 doc-templates/builders/add_custom_option_cells.py
    npm run contract:verify        # 반드시 이걸로 검증할 것
"""
import shutil
import sys
import zipfile
from pathlib import Path

from lxml import etree

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
XMLSPACE = '{http://www.w3.org/XML/1998/namespace}space'
ROOT = Path(__file__).resolve().parents[2]
DOCX = ROOT / 'doc-templates/contract-template.docx'
PART = 'word/document.xml'

LABEL_TOKEN = '{{spec_custom_label}}'
VALUE_TOKEN = '{{spec_custom}}'


def cell_text(tc) -> str:
    return ''.join(tc.itertext())


def first_p(tc):
    p = tc.find(W + 'p')
    if p is None:
        p = etree.SubElement(tc, W + 'p')
    return p


def put_token(target_tc, model_tc, token: str) -> None:
    """model_tc(같은 표의 형제 칸)의 문단·런 서식을 복제해 target_tc 에 token 을 넣는다."""
    model_p = model_tc.find(W + 'p')
    new_p = etree.fromstring(etree.tostring(model_p))          # 문단 속성째 복제
    for r in new_p.findall(W + 'r'):                            # 글자만 비운다
        new_p.remove(r)
    model_r = model_p.find(W + 'r')
    run = etree.SubElement(new_p, W + 'r')
    if model_r is not None:
        rpr = model_r.find(W + 'rPr')
        if rpr is not None:
            run.append(etree.fromstring(etree.tostring(rpr)))   # 글꼴·크기·굵기 유지
    t = etree.SubElement(run, W + 't')
    t.set(XMLSPACE, 'preserve')
    t.text = token
    for old in target_tc.findall(W + 'p'):
        target_tc.remove(old)
    target_tc.append(new_p)


def main() -> int:
    raw = zipfile.ZipFile(DOCX).read(PART)
    root = etree.fromstring(raw)

    patched = 0
    for tbl in root.iter(W + 'tbl'):
        rows = tbl.findall(W + 'tr')
        if not any('spec_temp' in cell_text(r) for r in rows):
            continue
        for tr in rows:
            cells = tr.findall(W + 'tc')
            if len(cells) < 4 or 'spec_temp' not in cell_text(tr):
                continue
            if LABEL_TOKEN in cell_text(cells[2]):
                print('이미 들어 있음 — 그대로 둔다')
                return 0
            if cell_text(cells[2]).strip() or cell_text(cells[3]).strip():
                print(f'✗ 온도기록계 행의 오른쪽 칸이 비어 있지 않다: '
                      f'{cell_text(cells[2])!r} / {cell_text(cells[3])!r}', file=sys.stderr)
                return 1
            put_token(cells[2], cells[0], LABEL_TOKEN)   # 라벨 서식은 라벨칸에서
            put_token(cells[3], cells[1], VALUE_TOKEN)   # 값 서식은 값칸에서
            patched += 1

    if patched == 0:
        print('✗ 온도기록계 행을 찾지 못했다 — 양식이 바뀌었는지 확인할 것', file=sys.stderr)
        return 1

    # docx 는 zip 이다. 다른 부품은 **그대로 옮겨** 서명 위치·글꼴이 틀어지지 않게 한다.
    new_xml = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    src = zipfile.ZipFile(DOCX)
    tmp = DOCX.with_suffix('.docx.tmp')
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as out:
        for item in src.infolist():
            out.writestr(item, new_xml if item.filename == PART else src.read(item.filename))
    src.close()
    shutil.move(str(tmp), str(DOCX))
    print(f'✓ {patched}개 행에 커스텀 옵션 칸을 넣었다 — npm run contract:verify 로 확인할 것')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
