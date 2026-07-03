from app.infrastructure.cifra.cifraclub_importer import (
    CifraClubImportResult,
    CifraClubImporter,
    is_cifra_club_url,
    parse_cifra_pre_content,
)


SAMPLE_PRE = """[Intro] <b>C7M</b>  <b>G/B</b>  <b>Am7</b>

[Primeira Parte]

  <b>G</b>
Quem foi muito perdoado
 <b>G9</b>                            <b>Em7</b>
Deveria saber o valor de ser amado
"""


def test_is_cifra_club_url() -> None:
    assert is_cifra_club_url("https://www.cifraclub.com.br/julliany-souza/ah-jesus-coracao-igual-ao-teu-2-2/")
    assert not is_cifra_club_url("https://www.youtube.com/watch?v=abc")


def test_parse_cifra_pre_content() -> None:
    sections = parse_cifra_pre_content(SAMPLE_PRE)
    assert len(sections) >= 2
    assert sections[0]["label"] == "Intro"
    intro_line = sections[0]["lines"][0]
    assert intro_line["placements"][0]["chord"] == "C7M"
    verse = next(section for section in sections if section["label"] == "Primeira Parte")
    assert verse["lines"][0]["placements"][0]["chord"] == "G"
    assert "Quem foi muito perdoado" in verse["lines"][0]["lyrics"]
    assert verse["lines"][1]["placements"][0]["chord"] == "G9"
    assert verse["lines"][1]["placements"][1]["chord"] == "Em7"
    assert "Deveria saber" in verse["lines"][1]["lyrics"]
    assert verse["lines"][1]["placements"][1]["offset"] > verse["lines"][1]["placements"][0]["offset"]


def test_parse_cifra_pre_content_without_section_header() -> None:
    pre_html = """<b>F#</b>
Pra onde eu posso ir?
<b>D#m</b>             <b>C#</b>            <b>B</b>
Se vida eterna encontro em Ti"""
    sections = parse_cifra_pre_content(pre_html)
    assert len(sections) == 1
    assert sections[0]["label"] == "Cifra"
    assert sections[0]["lines"][0]["placements"][0]["chord"] == "F#"


def test_extract_pre_html_without_bracket_header() -> None:
    from app.infrastructure.cifra.cifraclub_importer import _extract_pre_html

    html = "<html><pre><b>A</b> Linha sem colchete</pre></html>"
    assert _extract_pre_html(html).startswith("<b>A</b>")


def test_save_and_load(tmp_path) -> None:
    result = CifraClubImportResult(
        url="https://www.cifraclub.com.br/a/b/",
        title="Música",
        artist="Artista",
        key="G",
        mode="major",
        sections=[{"id": "section-0", "label": "Intro", "lines": []}],
    )
    path = tmp_path / "cifra_club.json"
    CifraClubImporter.save(result, path)
    loaded = CifraClubImporter.load(path)
    assert loaded is not None
    assert loaded["source"] == "cifra_club"
    assert loaded["title"] == "Música"
