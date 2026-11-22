"""Build the two review PDFs from the same source used by /terms and /privacy.

Requires reportlab. Run from any directory: python scripts/build-legal-pdfs.py
The bundled Noto-derived Korean font is distributed under public/fonts/OFL-Noto.txt.
"""
import json
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer

APP = Path(__file__).resolve().parents[1]
CONTENT = json.loads((APP / 'lib/legal-content.json').read_text(encoding='utf-8'))
OUTPUT = APP / 'public/legal'
OUTPUT.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(TTFont('QEDKorean', str(APP / 'public/fonts/MathgradeKorean-Regular.ttf')))
INK = colors.HexColor('#292337')
MUTED = colors.HexColor('#6b6177')
PURPLE = colors.HexColor('#7054b4')

body = ParagraphStyle('Body', fontName='QEDKorean', fontSize=9.2, leading=16,
                      textColor=INK, spaceAfter=7, wordWrap='CJK', alignment=TA_LEFT)
heading = ParagraphStyle('Section', parent=body, fontSize=12, leading=19,
                         spaceBefore=14, spaceAfter=8, keepWithNext=True, textColor=PURPLE)
title = ParagraphStyle('Title', parent=body, fontSize=27, leading=39, spaceAfter=12)
caption = ParagraphStyle('Caption', parent=body, fontSize=8, leading=14, textColor=MUTED)
notice = ParagraphStyle('Notice', parent=body, fontSize=9, leading=16,
                        backColor=colors.HexColor('#f4effb'), borderPadding=12,
                        spaceBefore=12, spaceAfter=22)


def page_frame(canvas, document):
    width, height = A4
    canvas.saveState()
    canvas.setTitle(f'Q.E.D. {document.policy_title} - 검토안')
    canvas.setAuthor('Q.E.D. / 김도현')
    canvas.setSubject(f'시행 전 검토안 / {CONTENT["version"]}')
    canvas.setFillColor(PURPLE)
    canvas.setFont('Helvetica-Bold', 10)
    canvas.drawString(46, height - 34, 'Q.E.D.')
    canvas.setFont('QEDKorean', 8)
    canvas.setFillColor(MUTED)
    canvas.drawRightString(width - 46, height - 34, f'{document.policy_title} / 검토안 · 시행 전')
    canvas.setStrokeColor(colors.HexColor('#e4dceb'))
    canvas.line(46, height - 46, width - 46, height - 46)
    canvas.line(46, 42, width - 46, 42)
    canvas.setFont('QEDKorean', 7.5)
    canvas.drawString(46, 27, f'{CONTENT["preparedAt"]} 작성 · doheyn1008@snu.ac.kr')
    canvas.drawRightString(width - 46, 27, str(document.page))
    canvas.restoreState()


for kind in ['terms', 'privacy']:
    source = CONTENT[kind]
    destination = OUTPUT / source['filename']
    document = SimpleDocTemplate(str(destination), pagesize=A4, rightMargin=46,
                                 leftMargin=46, topMargin=69, bottomMargin=61,
                                 pageCompression=1, invariant=1)
    document.policy_title = source['title']
    story = [Paragraph(escape(source['title']), title),
             Paragraph(f'{CONTENT["status"]} | 작성일 {CONTENT["preparedAt"]} | {CONTENT["version"]}', caption),
             Spacer(1, 10), Paragraph(escape(CONTENT['notice']), notice)]
    for section in source['sections']:
        story.append(Paragraph(escape(section['title']), heading))
        for paragraph in section['paragraphs']:
            story.append(Paragraph(escape(paragraph), body))
    story.extend([Spacer(1, 15), Paragraph('개발·운영 김도현 | 문의 doheyn1008@snu.ac.kr', caption)])
    document.build(story, onFirstPage=page_frame, onLaterPages=page_frame)
    print(destination)
