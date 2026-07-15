from __future__ import annotations

import html
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
README = ROOT / "README.md"
OUTPUT = ROOT / "output" / "pdf" / "conmaster_user_guide.pdf"
MARK = ROOT / "assets" / "conmaster-mark.png"

FONT_REGULAR = Path("C:/Windows/Fonts/malgun.ttf")
FONT_BOLD = Path("C:/Windows/Fonts/malgunbd.ttf")

BLUE = colors.HexColor("#1f4f82")
LIGHT_BLUE = colors.HexColor("#eaf4ff")
LINE = colors.HexColor("#d7e4f3")
TEXT = colors.HexColor("#1b2a3a")
MUTED = colors.HexColor("#5c6b7a")


def register_fonts() -> tuple[str, str]:
    regular = "Malgun"
    bold = "MalgunBold"
    pdfmetrics.registerFont(TTFont(regular, str(FONT_REGULAR)))
    pdfmetrics.registerFont(TTFont(bold, str(FONT_BOLD)))
    return regular, bold


def clean_inline(text: str) -> str:
    text = text.strip()
    text = re.sub(r"\*\*(.*?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    return text


def para(text: str, style: ParagraphStyle) -> Paragraph:
    safe = html.escape(clean_inline(text), quote=False)
    safe = safe.replace("&lt;b&gt;", "<b>").replace("&lt;/b&gt;", "</b>")
    return Paragraph(safe, style)


def table_from_markdown(lines: list[str], styles: dict[str, ParagraphStyle]) -> Table:
    rows: list[list[Paragraph]] = []
    for line in lines:
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if all(set(cell) <= {"-", " "} for cell in cells):
            continue
        rows.append([para(cell, styles["table_cell"]) for cell in cells])

    col_widths = [52 * mm, 105 * mm] if rows and len(rows[0]) == 2 else None
    table = Table(rows, colWidths=col_widths, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), LIGHT_BLUE),
                ("TEXTCOLOR", (0, 0), (-1, 0), BLUE),
                ("FONTNAME", (0, 0), (-1, 0), styles["font_bold"]),
                ("GRID", (0, 0), (-1, -1), 0.5, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    return table


def mermaid_summary(block: str, styles: dict[str, ParagraphStyle]) -> list:
    if "start[" in block:
        steps = [
            "1. 프로젝트 생성",
            "2. 검토 공종 선택",
            "3. 도면, 시방서, 내역서 업로드",
            "4. AI 검토에 사용할 문서 선택",
            "5. 문서 내용 추출",
            "6. AI 검토 실행",
            "7. 검토 결과 확인",
            "8. RFI 문서 생성 및 다운로드",
        ]
        title = "사용 흐름 구조도"
    else:
        steps = [
            "사용자는 Vercel에 배포된 웹사이트에 접속합니다.",
            "웹사이트는 Railway 서버에 파일 업로드와 분석을 요청합니다.",
            "서버는 PostgreSQL에 프로젝트와 결과를 저장합니다.",
            "서버는 Cloudflare R2에 업로드 문서와 RFI 문서를 보관합니다.",
            "서버는 OpenAI API로 검토 후보를 정리합니다.",
            "정리된 결과는 다시 웹 화면에 표시됩니다.",
        ]
        title = "서비스 구조도"

    content = [[para(title, styles["diagram_title"])]]
    for step in steps:
        content.append([para(step, styles["diagram_text"])])
    table = Table(content, colWidths=[160 * mm], hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), LIGHT_BLUE),
                ("BOX", (0, 0), (-1, -1), 0.8, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    return [table, Spacer(1, 5 * mm)]


def build_story(readme: str, styles: dict[str, ParagraphStyle]) -> list:
    story = []
    lines = readme.splitlines()
    i = 1

    while i < len(lines):
        line = lines[i].rstrip()

        if not line:
            i += 1
            continue

        if line.startswith("```mermaid"):
            block: list[str] = []
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                block.append(lines[i])
                i += 1
            story.extend(mermaid_summary("\n".join(block), styles))
            i += 1
            continue

        if line.startswith("|"):
            table_lines = []
            while i < len(lines) and lines[i].startswith("|"):
                table_lines.append(lines[i])
                i += 1
            story.append(table_from_markdown(table_lines, styles))
            story.append(Spacer(1, 5 * mm))
            continue

        if line.startswith("## "):
            story.append(Spacer(1, 4 * mm))
            story.append(para(line[3:], styles["h2"]))
            story.append(Spacer(1, 2 * mm))
            i += 1
            continue

        if line.startswith("### "):
            story.append(Spacer(1, 3 * mm))
            story.append(para(line[4:], styles["h3"]))
            story.append(Spacer(1, 1.5 * mm))
            i += 1
            continue

        if line.startswith("- "):
            story.append(para("- " + line[2:], styles["list"]))
            i += 1
            continue

        if re.match(r"^\d+\. ", line):
            story.append(para(line, styles["list"]))
            i += 1
            continue

        story.append(para(line, styles["body"]))
        story.append(Spacer(1, 1.5 * mm))
        i += 1

    return story


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Malgun", 7)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 11 * mm, "CONMA · Construction Master")
    canvas.drawRightString(192 * mm, 11 * mm, str(doc.page))
    canvas.restoreState()


def main() -> None:
    regular, bold = register_fonts()
    sample = getSampleStyleSheet()
    styles: dict[str, ParagraphStyle | str] = {
        "font_bold": bold,
        "cover_title": ParagraphStyle(
            "cover_title",
            parent=sample["Title"],
            fontName=bold,
            fontSize=22,
            leading=30,
            alignment=TA_CENTER,
            textColor=TEXT,
            spaceAfter=8,
        ),
        "cover_subtitle": ParagraphStyle(
            "cover_subtitle",
            parent=sample["BodyText"],
            fontName=regular,
            fontSize=11,
            leading=17,
            alignment=TA_CENTER,
            textColor=MUTED,
        ),
        "cover_note": ParagraphStyle(
            "cover_note",
            parent=sample["BodyText"],
            fontName=regular,
            fontSize=10,
            leading=16,
            textColor=TEXT,
            borderColor=LINE,
            borderWidth=0.6,
            borderPadding=8,
            backColor=colors.HexColor("#f5faff"),
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=sample["Heading2"],
            fontName=bold,
            fontSize=16,
            leading=22,
            textColor=BLUE,
            spaceBefore=5,
            spaceAfter=4,
        ),
        "h3": ParagraphStyle(
            "h3",
            parent=sample["Heading3"],
            fontName=bold,
            fontSize=12.5,
            leading=18,
            textColor=TEXT,
        ),
        "body": ParagraphStyle(
            "body",
            parent=sample["BodyText"],
            fontName=regular,
            boldFontName=bold,
            fontSize=9.6,
            leading=15,
            textColor=TEXT,
            wordWrap="CJK",
        ),
        "list": ParagraphStyle(
            "list",
            parent=sample["BodyText"],
            fontName=regular,
            boldFontName=bold,
            fontSize=9.4,
            leading=14.5,
            leftIndent=6 * mm,
            firstLineIndent=-4 * mm,
            textColor=TEXT,
            wordWrap="CJK",
        ),
        "table_cell": ParagraphStyle(
            "table_cell",
            parent=sample["BodyText"],
            fontName=regular,
            boldFontName=bold,
            fontSize=8.6,
            leading=12.5,
            textColor=TEXT,
            wordWrap="CJK",
        ),
        "diagram_title": ParagraphStyle(
            "diagram_title",
            parent=sample["BodyText"],
            fontName=bold,
            fontSize=10,
            leading=14,
            textColor=BLUE,
        ),
        "diagram_text": ParagraphStyle(
            "diagram_text",
            parent=sample["BodyText"],
            fontName=regular,
            fontSize=8.8,
            leading=13,
            textColor=TEXT,
            wordWrap="CJK",
        ),
    }

    readme = README.read_text(encoding="utf-8")
    title = "콘마(CONMA) 설명서"
    description = (
        "Construction Master · AI-CM 설계정보 검토 보조 서비스"
    )

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=title,
    )

    story = []
    story.append(Spacer(1, 20 * mm))
    if MARK.exists():
        story.append(Image(str(MARK), width=35 * mm, height=35 * mm, hAlign="CENTER"))
        story.append(Spacer(1, 8 * mm))
    story.append(para(title, styles["cover_title"]))
    story.append(para(description, styles["cover_subtitle"]))
    story.append(Spacer(1, 12 * mm))
    story.append(
        para(
            "비전공자도 서비스 목적, 사용 흐름, 시스템 구조, 현재 구현 기능을 한 번에 이해할 수 있도록 정리한 문서입니다.",
            styles["cover_note"],
        )
    )
    story.append(PageBreak())
    story.extend(build_story(readme, styles))

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(OUTPUT)


if __name__ == "__main__":
    main()
