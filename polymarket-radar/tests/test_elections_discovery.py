from radar.elections.discovery import classify


def c(q, ev="", item=None, slug=None, cat="elections"):
    return classify(q, ev, item, slug, cat)


def test_brazil_winner_markets_are_modeled():
    r = c("Will Luiz Inácio Lula da Silva win the 2026 Brazilian presidential election?",
          "Brazil Presidential Election", "Luiz Inácio Lula da Silva",
          "brazil-presidential-election")  # fmt: skip
    assert (r.market_type, r.office, r.country, r.year) == ("ganador", "presidente", "BR", 2026)
    assert r.contest_key == "br-2026-presidente-2t" and r.coverage == "modelado"


def test_brazil_derived_markets_are_linked_but_abstain():
    r = c("Will Lula win the most votes in the second round of the Brazil presidential election in Bahia?",  # noqa: E501
          "Brazil Presidential Election Second Round: 1st Place in Bahia", "Lula",
          "brazil-presidential-election-second-round-1st-place-in-bahia")  # fmt: skip
    assert r.contest_key == "br-2026-presidente-2t" and r.coverage == "abstencion"
    assert r.market_type == "ganador_regional" and r.round == 2
    assert "no modelado" in r.abstain_reason


def test_other_types_and_no_source():
    assert (
        c(
            "Will the Republican Party candidate win the 2026 CO-08 House election by 3% or more?"
        ).market_type
        == "margen"
    )
    assert c("Will the Republican Party win the CA-07 House seat?").market_type == "ganador"
    assert (
        c(
            "Will One Nation win the second-most seats in the next Victorian state election?"
        ).market_type
        == "posicion"
    )
    assert (
        c("Will Matteo Renzi be the next Prime Minister of Italy?").market_type == "proximo_cargo"
    )
    r = c("Will Sergio Massa win the 2027 Argentina presidential election?")
    assert r.country == "AR" and r.coverage == "abstencion"
    assert r.abstain_reason == "sin fuente de encuestas configurada para esta contienda"


def test_non_electoral_market_is_ignored():
    r = classify(
        "Will Bitcoin reach $250,000 by December 31, 2026?", "Bitcoin", None, "btc", "crypto"
    )
    assert not r.electoral
