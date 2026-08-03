#!/usr/bin/env python3
"""원본 특장매매계약서.docx → 빈 값 셀에 docxtemplater {태그} 심은 템플릿 생성 (lxml, 무손실).
레이아웃/폰트/표/텍스트박스 원본 그대로. 값 셀 텍스트만 주입. 서명 앵커는 첫 서명표 매수인 셀에만.
"""
import sys, copy, os, zipfile
from lxml import etree

src, dst = sys.argv[1], sys.argv[2]
NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
W = '{'+NS+'}'
XMLSPACE = '{http://www.w3.org/XML/1998/namespace}space'

raw = zipfile.ZipFile(src).read('word/document.xml')
root = etree.fromstring(raw)  # lxml: 네임스페이스/속성 무손실
# 문서 순서의 모든 표(텍스트박스 내부 포함)
tables = list(root.iter(W+'tbl'))
print("발견 표 수:", len(tables))

def first_p(tc): return tc.find(W+'p')
def label_run(tc):
    p = first_p(tc)
    return p.find(W+'r') if p is not None else None

def make_run(text, style_src=None):
    r = etree.Element(W+'r')
    if style_src is not None:
        rpr = style_src.find(W+'rPr')
        if rpr is not None:
            r.append(copy.deepcopy(rpr))
    t = etree.SubElement(r, W+'t'); t.set(XMLSPACE, 'preserve'); t.text = text
    return r

def set_tag(ti, row, col, tag, mode='append', style_col=0):
    tbl = tables[ti]
    cells = tbl.findall(W+'tr')[row].findall(W+'tc')
    tc = cells[col]; p = first_p(tc)
    style = label_run(cells[style_col]) if (style_col is not None and style_col < len(cells)) else None
    run = make_run(tag, style)
    if mode == 'replace':
        for r in p.findall(W+'r'): p.remove(r)
        p.append(run)
    elif mode == 'prepend':
        idx = 0
        for i, ch in enumerate(list(p)):
            if ch.tag == W+'pPr': idx = i+1; break
        p.insert(idx, run)
    else:
        p.append(run)

# T0 계약정보: 계약번호값=c1. 계약일자 전용 값칸이 없어 c2(계약일자 라벨, 폭5670)를
# 절반으로 나눠 그 옆에 값칸(2835)을 새로 끼워넣음(총폭 17541 유지). c4는 계약처 값(공란).
set_tag(0, 0, 1, '{계약번호}')

def add_contract_date_cell():
    t0 = tables[0]
    tr = t0.findall(W+'tr')[0]
    cells = tr.findall(W+'tc')
    c2 = cells[2]  # 계약일자 라벨(폭 5670)
    newcell = copy.deepcopy(cells[1])  # 값셀(c1) 구조 복제
    # 폭: c2 5670 → 2835, 새 값셀 2835
    for tc, w in ((c2, '2835'), (newcell, '2835')):
        tcw = tc.find(W+'tcPr/'+W+'tcW')
        if tcw is not None:
            tcw.set(W+'w', w)
    # 새 값셀에 {계약일자} 태그(값셀 문단 스타일 유지)
    p = newcell.find(W+'p')
    for r in p.findall(W+'r'):
        p.remove(r)
    run = etree.Element(W+'r')
    ppr = p.find(W+'pPr')
    if ppr is not None:
        rpr = ppr.find(W+'rPr')
        if rpr is not None:
            run.append(copy.deepcopy(rpr))
    t = etree.SubElement(run, W+'t'); t.set(XMLSPACE, 'preserve'); t.text = '{계약일자}'
    p.append(run)
    c2.addnext(newcell)
    # tblGrid: 5670 칸을 2835 두 개로
    grid = t0.find(W+'tblGrid')
    gcols = grid.findall(W+'gridCol')
    gcols[2].set(W+'w', '2835')
    newgc = etree.Element(W+'gridCol'); newgc.set(W+'w', '2835')
    gcols[2].addnext(newgc)

add_contract_date_cell()
# T1 매수인
set_tag(1, 0, 1, '{성명}')
set_tag(1, 0, 7, '{사업자번호}')
set_tag(1, 1, 1, '{주소}')
set_tag(1, 2, 4, '{휴대폰}')
set_tag(1, 3, 4, '{이메일}')
# T2/T3 특장사양(2부)
for ti in (2, 3):
    set_tag(ti, 0, 1, '{탑종류}')
    set_tag(ti, 1, 1, '{탑높이}')
    set_tag(ti, 1, 3, '{도어옵션}', mode='replace')
    set_tag(ti, 2, 1, '{스포일러}')
    set_tag(ti, 2, 3, '{도어추가}')
    set_tag(ti, 3, 1, '{온도기록계}')
    set_tag(ti, 3, 3, '{격벽}')
    # 표 전체 폭이 텍스트박스보다 커서 우측 열이 통째로 클리핑됨 → 텍스트박스 안에 맞게 전체 재분배
    NEWCOLS = [2944, 5918, 3120, 2390]  # 좌측(c0~c2) 원본유지·리플로우방지, 과대 c3만 축소. 합계 14372 = 텍스트박스폭
    tbl = tables[ti]
    # 표 고정 선호폭(tblW)이 31605로 박혀 gridCol을 무시 → 합계에 맞게 갱신
    tpr = tbl.find(W+'tblPr')
    if tpr is not None:
        tblw = tpr.find(W+'tblW')
        if tblw is not None:
            tblw.set(W+'w', str(sum(NEWCOLS)))
            tblw.set(W+'type', 'dxa')
    grid = tbl.find(W+'tblGrid')
    if grid is not None:
        gcols = grid.findall(W+'gridCol')
        for i, gc in enumerate(gcols):
            if i < len(NEWCOLS):
                gc.set(W+'w', str(NEWCOLS[i]))
    for tr in tbl.findall(W+'tr'):
        cs = tr.findall(W+'tc')
        if len(cs) >= 4:
            for i in range(4):
                tcw = cs[i].find(W+'tcPr/'+W+'tcW')
                if tcw is not None:
                    tcw.set(W+'w', str(NEWCOLS[i]))
        elif len(cs) == 2:
            # r0(탑종류): 값셀이 나머지 폭 스팬
            tcw0 = cs[0].find(W+'tcPr/'+W+'tcW'); tcw1 = cs[1].find(W+'tcPr/'+W+'tcW')
            if tcw0 is not None: tcw0.set(W+'w', str(NEWCOLS[0]))
            if tcw1 is not None: tcw1.set(W+'w', str(sum(NEWCOLS[1:])))
# T4/T5 가격(값 앞 '원' → prepend)
for ti in (4, 5):
    set_tag(ti, 0, 1, '{특장가격} ', mode='prepend')
    set_tag(ti, 1, 1, '{계약금} ', mode='prepend')
    set_tag(ti, 2, 1, '{잔금} ', mode='prepend')
# T6 서명(첫 서명표) 매수인 셀 r3 c1 에 앵커 추가(새 문단)
tbl = tables[6]
tc = tbl.findall(W+'tr')[3].findall(W+'tc')[1]
newp = etree.SubElement(tc, W+'p')
for anchor in ['성명 [고객성명]', '서명 [고객서명]', '일자 [서명일자]']:
    newp.append(make_run(anchor + '    ', label_run(tc)))

# 폰트 정규화: 비표준·미설치 폰트 → Noto Sans CJK KR (로컬·서버 공통 설치, 서버는 Noto로 렌더)
FONT_SWAP = {
    '프리젠테이션 4': 'Noto Sans CJK KR',
    '맑은 고딕': 'Noto Sans CJK KR',
    '굴림': 'Noto Sans CJK KR',
    'Calibri': 'Noto Sans CJK KR',
}
FONT_PARTS = {'word/document.xml', 'word/styles.xml', 'word/theme/theme1.xml', 'word/fontTable.xml'}
def norm_fonts(b):
    t = b.decode('utf-8')
    for a, c in FONT_SWAP.items():
        t = t.replace(a, c)
    return t.encode('utf-8')

out = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
tmp = dst + '.tmp'
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
    for it in zin.infolist():
        data = zin.read(it.filename)
        if it.filename == 'word/document.xml':
            data = out
        if it.filename in FONT_PARTS:
            data = norm_fonts(data)
        zout.writestr(it, data)
os.replace(tmp, dst)
print("template written:", dst, os.path.getsize(dst), "bytes")
