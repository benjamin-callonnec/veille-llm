"""A tiny real PDF generator for tests: Helvetica text pages and an optional outline."""


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def make_pdf(
    pages: list[str],
    outline: list[tuple[str, int]] | None = None,
    sizes: dict[str, int] | None = None,
) -> bytes:
    """`pages` are texts (lines split on newlines); `outline` is [(title, 1-based page)];
    `sizes` maps a line of text to its font size (12 for any other line)."""
    sizes = sizes or {}
    count = len(pages)
    page_ids = [4 + 2 * i for i in range(count)]
    content_ids = [5 + 2 * i for i in range(count)]
    outline = outline or []
    root = 4 + 2 * count
    item_ids = [root + 1 + i for i in range(len(outline))]

    bodies: dict[int, str] = {}
    catalog = "<< /Type /Catalog /Pages 2 0 R"
    if outline:
        catalog += f" /Outlines {root} 0 R"
    bodies[1] = catalog + " >>"
    kids = " ".join(f"{i} 0 R" for i in page_ids)
    bodies[2] = f"<< /Type /Pages /Kids [{kids}] /Count {count} >>"
    bodies[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    for i, text in enumerate(pages):
        lines = text.split("\n") if text else []
        stream = "BT /F1 12 Tf 72 720 Td 16 TL " + " T* ".join(
            f"/F1 {sizes[line]} Tf ({_escape(line)}) Tj /F1 12 Tf"
            if line in sizes
            else f"({_escape(line)}) Tj"
            for line in lines
        )
        stream += " ET" if lines else "BT ET"
        bodies[page_ids[i]] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {content_ids[i]} 0 R >>"
        )
        bodies[content_ids[i]] = f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream"
    if outline:
        bodies[root] = (
            f"<< /Type /Outlines /First {item_ids[0]} 0 R /Last {item_ids[-1]} 0 R "
            f"/Count {len(outline)} >>"
        )
        for i, (title, page) in enumerate(outline):
            target = page_ids[page - 1]
            item = f"<< /Title ({_escape(title)}) /Parent {root} 0 R /Dest [{target} 0 R /Fit]"
            if i > 0:
                item += f" /Prev {item_ids[i - 1]} 0 R"
            if i < len(outline) - 1:
                item += f" /Next {item_ids[i + 1]} 0 R"
            bodies[item_ids[i]] = item + " >>"

    out = bytearray(b"%PDF-1.4\n")
    offsets: dict[int, int] = {}
    for number in sorted(bodies):
        offsets[number] = len(out)
        out += f"{number} 0 obj\n{bodies[number]}\nendobj\n".encode("latin-1")
    xref = len(out)
    size = max(bodies) + 1
    out += f"xref\n0 {size}\n0000000000 65535 f \n".encode()
    for number in range(1, size):
        out += f"{offsets[number]:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {size} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)
