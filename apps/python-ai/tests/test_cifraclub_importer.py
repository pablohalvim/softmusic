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
    assert intro_line["lyrics"] == ""
    assert [p["chord"] for p in intro_line["placements"]] == ["C7M", "G/B", "Am7"]
    # Gaps entre acordes da Intro não podem colapsar (empilhar).
    intro_offsets = [p["offset"] for p in intro_line["placements"]]
    assert intro_offsets == sorted(set(intro_offsets))
    assert intro_offsets[0] == 0
    assert intro_offsets[1] > intro_offsets[0]
    assert intro_offsets[2] > intro_offsets[1]
    verse = next(section for section in sections if section["label"] == "Primeira Parte")
    assert verse["lines"][0]["placements"][0]["chord"] == "G"
    assert verse["lines"][0]["placements"][0]["offset"] == 2  # dois espaços à esquerda
    assert "Quem foi muito perdoado" in verse["lines"][0]["lyrics"]
    assert verse["lines"][1]["placements"][0]["chord"] == "G9"
    assert verse["lines"][1]["placements"][1]["chord"] == "Em7"
    assert "Deveria saber" in verse["lines"][1]["lyrics"]
    assert verse["lines"][1]["placements"][0]["offset"] == 1
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


SAMPLE_PRE_NEW_MARKUP = """
<div class="kvMV">[Intro] <b data-chord-name="D" data-chord-index="0">D</b>  <b data-chord-name="Bm">Bm</b>  <b data-chord-name="A">A</b>  <b data-chord-name="G">G</b>

[Primeira Parte]

</div><div class="kvMV">  <b data-chord-name="D">D</b>          <b data-chord-name="Bm">Bm</b>    <b data-chord-name="A">A</b>
Quem é como Tu, Jesus
</div><div class="kvMV">     <b data-chord-name="G">G</b>                  <b data-chord-name="D">D</b>
Não há ninguém além de Ti
</div>
"""


def test_parse_cifra_pre_content_new_markup() -> None:
    sections = parse_cifra_pre_content(SAMPLE_PRE_NEW_MARKUP)
    assert len(sections) >= 2
    assert sections[0]["label"] == "Intro"
    intro = sections[0]["lines"][0]
    assert intro["lyrics"] == ""
    assert [p["chord"] for p in intro["placements"]] == ["D", "Bm", "A", "G"]
    intro_offsets = [p["offset"] for p in intro["placements"]]
    assert intro_offsets == [0, 3, 7, 10]
    verse = next(section for section in sections if section["label"] == "Primeira Parte")
    first = verse["lines"][0]
    assert first["lyrics"].startswith("Quem é como Tu")
    assert [p["chord"] for p in first["placements"]] == ["D", "Bm", "A"]
    # Como no <pre>: "  D          Bm    A" → D@2, Bm@13, A@19
    assert [p["offset"] for p in first["placements"]] == [2, 13, 19]
    second = verse["lines"][1]
    assert [p["offset"] for p in second["placements"]] == [5, 24]
    # Acordes NÃO devem aparecer como linha de letra.
    assert not any(line["lyrics"].strip().startswith("D") and "Quem" not in line["lyrics"] for line in verse["lines"] if line["placements"])


def test_instrumental_solo_chords_keep_spacing() -> None:
    pre = """[Solo] <b>G</b>  <b>A</b>  <b>D/F#</b>  <b>Bm</b>  <b>A</b>
       <b>G</b>  <b>A</b>  <b>D/F#</b>  <b>Bm</b>  <b>A</b>

[Tab - Solo]
Parte 1
"""
    sections = parse_cifra_pre_content(pre)
    solo = next(section for section in sections if section["label"] == "Solo")
    assert len(solo["lines"]) == 2
    first_offsets = [p["offset"] for p in solo["lines"][0]["placements"]]
    second_offsets = [p["offset"] for p in solo["lines"][1]["placements"]]
    assert first_offsets == sorted(set(first_offsets))
    assert second_offsets == sorted(set(second_offsets))
    assert first_offsets[0] == 0
    assert second_offsets[0] == 7  # sete espaços à esquerda
    assert [p["chord"] for p in solo["lines"][0]["placements"]] == ["G", "A", "D/F#", "Bm", "A"]
    # 2ª linha do Solo não pode “vazar” para a seção seguinte.
    tab = next(section for section in sections if section["label"] == "Tab - Solo")
    assert all(not line["placements"] for line in tab["lines"])


def test_extract_key_ignores_css_tom_calc() -> None:
    from app.infrastructure.cifra.cifraclub_importer import _extract_key

    html = """
    <style>.x{tom:calc(1px)}</style>
    <button data-anchor="--chord-tone">D</button>
    """
    assert _extract_key(html) == "D"

    html_css_only = '<style>.x{tom:calc(1px)}</style><div>Tom: <span>E</span></div>'
    assert _extract_key(html_css_only) == "E"


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
