"""Audit W01 documents and fixture facts; this is not the application poker engine."""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import re
from collections import Counter
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_PATH = APP_ROOT / "tests/fixtures/scenarios.json"
REQUIRED = {"id", "category", "description", "given", "when", "expected", "scope", "source"}
RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]
DECK = [rank + suit for suit in "SHCD" for rank in RANKS]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def strict_json(text: str):
    def reject_constant(value: str):
        raise ValueError(f"Non-JSON constant: {value}")

    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, f"Duplicate object key: {key}")
            result[key] = value
        return result

    return json.loads(text, parse_constant=reject_constant, object_pairs_hook=unique_object)


def audit_card_value(cards: list[str]) -> tuple[int, ...]:
    """Independent small fixture calculation, not imported by any application package."""
    require(5 <= len(cards) <= 7, "Invalid card count in positive evaluation fixture")
    require(len(set(cards)) == len(cards), "Duplicate card in positive fixture")
    require(all(card in DECK for card in cards), "Unknown card ID")

    def value(five):
        values = [RANKS.index(card[:-1]) + 2 for card in five]
        counts = Counter(values)
        groups = sorted(((count, rank) for rank, count in counts.items()), reverse=True)
        descending = sorted(values, reverse=True)
        distinct = sorted(counts)
        straight = 5 if distinct == [2, 3, 4, 5, 14] else (
            max(distinct) if len(distinct) == 5 and max(distinct) - min(distinct) == 4 else 0
        )
        flush = len({card[-1] for card in five}) == 1
        if flush and straight:
            return (8, straight)
        if groups[0][0] == 4:
            return (7, groups[0][1], groups[1][1])
        if [group[0] for group in groups] == [3, 2]:
            return (6, groups[0][1], groups[1][1])
        if flush:
            return (5, *descending)
        if straight:
            return (4, straight)
        if groups[0][0] == 3:
            return (3, groups[0][1], *sorted((rank for count, rank in groups if count == 1), reverse=True))
        pairs = sorted((rank for count, rank in groups if count == 2), reverse=True)
        kickers = sorted((rank for count, rank in groups if count == 1), reverse=True)
        if len(pairs) == 2:
            return (2, *pairs, *kickers)
        if pairs:
            return (1, *pairs, *kickers)
        return (0, *descending)

    return max(value(five) for five in itertools.combinations(cards, 5))


def audit_deal(seats: list[int], dealer: int, deck: list[str]) -> dict:
    order = sorted(seats, key=lambda seat: (seat - dealer - 1) % 4)
    holes = {str(seat): [] for seat in seats}
    cursor = 0
    for _ in range(2):
        for seat in order:
            holes[str(seat)].append(deck[cursor])
            cursor += 1
    board, burns = [], []
    for count in (3, 1, 1):
        burns.append(deck[cursor])
        cursor += 1
        board.extend(deck[cursor:cursor + count])
        cursor += count
    return dict(holeCards=holes, board=board, burnCards=burns, consumed=cursor, dealOrder=order)


def audit_pots(row: dict) -> None:
    given, expected = row["given"], row["expected"]
    original = given["contributions"]
    contribution = original.copy()
    amounts = sorted(contribution.values(), reverse=True)
    refunds = {}
    if len(amounts) > 1 and amounts[0] > amounts[1]:
        owner = max(contribution, key=contribution.get)
        refunds[owner] = amounts[0] - amounts[1]
        contribution[owner] -= refunds[owner]
    require(refunds == expected["refunds"], row["id"] + " refunds")
    lower = 0
    actual_pots = []
    payouts = dict.fromkeys(original, 0)
    for upper in sorted({amount for amount in contribution.values() if amount > 0}):
        contributors = [owner for owner, amount in contribution.items() if amount >= upper]
        eligible = [owner for owner in contributors if owner not in given["foldedPlayerIds"]]
        require(bool(eligible), row["id"] + " empty eligible set")
        size = (upper - lower) * len(contributors)
        best = max(tuple(given["handRanks"][owner]) for owner in eligible)
        winners = [owner for owner in eligible if tuple(given["handRanks"][owner]) == best]
        actual_pots.append(dict(amount=size, eligiblePlayerIds=eligible, winnerPlayerIds=winners))
        share, odd = divmod(size, len(winners))
        ordered = sorted(winners, key=lambda owner: (given["seatIds"][owner] - given["dealerSeatId"] - 1) % 4)
        for owner in winners:
            payouts[owner] += share
        for owner in ordered[:odd]:
            payouts[owner] += 1
        lower = upper
    require(actual_pots == expected["pots"], row["id"] + " pot layers or eligibility")
    require(payouts == expected["payouts"], row["id"] + " payouts")
    require(sum(original.values()) == sum(refunds.values()) + sum(payouts.values()), row["id"] + " conservation")
    require(expected["potTotal"] == sum(pot["amount"] for pot in actual_pots), row["id"] + " total")
    require(expected["originalContributionTotal"] == sum(original.values()), row["id"] + " original total")
    require(expected["refundTotal"] == sum(refunds.values()), row["id"] + " refund total")
    require(expected["payoutTotal"] == sum(payouts.values()), row["id"] + " payout total")


def audit() -> dict:
    rows = strict_json(FIXTURE_PATH.read_text(encoding="utf-8"))
    require(isinstance(rows, list), "Root must be array")
    require(all(isinstance(row, dict) and REQUIRED <= row.keys() for row in rows), "Missing fields")
    ids = [row["id"] for row in rows]
    require(len(ids) == len(set(ids)), "Duplicate scenario ID")
    groups = {"C": 3, "E": 7, "O": 5, "B": 12, "S": 5, "P": 7, "I": 2}
    core = {f"{prefix}{number:02}" for prefix, count in groups.items() for number in range(1, count + 1)}
    extra = {f"{prefix}{number:02}" for prefix, count in {"RANK": 4, "ROOM": 13, "LIFE": 12, "PRIV": 4}.items() for number in range(1, count + 1)}
    require(set(ids) == core | extra, "Scenario ID coverage mismatch")
    by_id = {row["id"]: row for row in rows}
    for row in rows:
        require(all(row[field] for field in ("description", "given", "when", "expected")), row["id"] + " empty data")
        require(isinstance(row["when"].get("operation"), str), row["id"] + " missing operation")
        source = row["source"]
        require((FIXTURE_PATH.parent / source["document"]).is_file(), row["id"] + " broken provenance")
        require(source["scenarioId"] == row["id"], row["id"] + " wrong source ID")

    require(by_id["C01"]["expected"]["deckOrder"] == DECK, "C01 deck order")
    require(len(by_id["C02"]["given"]["seatSets"]) == len(by_id["C02"]["expected"]["variants"]) == 3, "C02 variants")
    for seats, expected in zip(by_id["C02"]["given"]["seatSets"], by_id["C02"]["expected"]["variants"]):
        actual = audit_deal(seats, 0, DECK)
        require(all(actual[key] == expected[key] for key in actual), "C02 fixed deal")
        used = sum(actual["holeCards"].values(), []) + actual["board"] + actual["burnCards"]
        require(len(used) == len(set(used)) == actual["consumed"], "C02 duplicate dealt cards")
    shuffled = DECK.copy()
    for index in range(51, 0, -1):
        shuffled[index], shuffled[0] = shuffled[0], shuffled[index]
    require(shuffled == by_id["C03"]["expected"]["shuffledDeck"], "C03 random stub output")

    categories = set()
    for identifier in ["E01", "E02", "E03", "E04", "RANK01", "RANK02", "RANK03", "RANK04"]:
        row = by_id[identifier]
        actual = audit_card_value(row["given"]["cards"])
        require(actual == (row["expected"]["category"], *row["expected"]["tieBreak"]), identifier + " hand rank")
        if "bestFiveSet" in row["expected"]:
            best = row["expected"]["bestFiveSet"]
            require(len(best) == 5 and set(best) <= set(row["given"]["cards"]), identifier + " best five subset")
            require(audit_card_value(best) == actual, identifier + " best five rank")
        categories.add(actual[0])
    for seat, cards in by_id["E06"]["given"]["hands"].items():
        actual = audit_card_value(cards)
        require(actual == tuple(by_id["E06"]["expected"]["ranks"][seat]), "E06 kicker rank")
        categories.add(actual[0])
    require(categories == set(range(9)), "Nine hand categories not covered")
    for hole in by_id["E05"]["given"]["holeCards"].values():
        require(audit_card_value(by_id["E05"]["given"]["board"] + hole) == (8, 14), "E05 board tie")
    require([len(cards) != len(set(cards)) or not 5 <= len(cards) <= 7 for cards in by_id["E07"]["given"]["invalidInputs"]] == [True] * 3, "E07 negatives")

    for row in rows:
        given = row["given"]
        if "settlementBoard" in given:
            known = given["settlementBoard"] + sum(given["settlementHoleCards"].values(), [])
            require(len(known) == len(set(known)), row["id"] + " duplicate settlement cards")
            for owner, hole in given["settlementHoleCards"].items():
                require(audit_card_value(given["settlementBoard"] + hole) == tuple(given["handRanks"][owner]), row["id"] + " settlement rank")
    for number in range(1, 8):
        audit_pots(by_id[f"P{number:02}"])

    for identifier in ["B01", "B02", "B03", "B04", "B05", "B06", "B07", "B09", "O05"]:
        row = by_id[identifier]
        actor = next(player for player in row["given"]["players"] if player["seatId"] == row["given"]["actorSeatId"])
        expected = row["expected"]
        require(expected["callAmount"] == max(0, row["given"]["currentBet"] - actor["streetCommitted"]), identifier + " call amount")
        if expected.get("minRaiseTo") is not None:
            require(expected["minRaiseTo"] == row["given"]["currentBet"] + row["given"]["lastFullRaiseSize"], identifier + " minimum raise")
            if "additionalAmountAtMinRaise" in expected:
                require(expected["additionalAmountAtMinRaise"] == expected["minRaiseTo"] - actor["streetCommitted"], identifier + " incremental amount")
    require(any(player["seatId"] != 0 and player["stack"] > 0 and not player["folded"] for player in by_id["B04"]["given"]["players"]), "B04 needs responsive opponent")
    require(not any(player["seatId"] != 0 and player["stack"] > 0 and not player["folded"] for player in by_id["B09"]["given"]["players"]), "B09 must have no responsive opponent")

    for seats, expected in zip(by_id["S01"]["given"]["seatSets"], by_id["S01"]["expected"]["variants"]):
        deal = audit_deal(seats, 0, DECK)
        values = {seat: audit_card_value(deal["board"] + hole) for seat, hole in deal["holeCards"].items()}
        best = max(values.values())
        winners = [int(seat) for seat, value in values.items() if value == best]
        require(winners == expected["winnerSeatIds"], "S01 winners")
        require(deal["board"] == expected["board"] and deal["consumed"] == expected["consumed"], "S01 deal")
        pot = len(seats) * 20
        stacks = {str(seat): 1980 + (pot // len(winners) if seat in winners else 0) for seat in seats}
        require(stacks == expected["finalStacks"], "S01 final stacks")
    for number in range(1, 10):
        row = by_id[f"ROOM{number:02}"]
        members = row["given"]["members"]
        require(2 <= len(members) <= row["given"]["capacity"] <= 4, row["id"] + " capacity")
        require(len({member["seatId"] for member in members}) == len(members), row["id"] + " duplicate seat")
        require(row["expected"]["participantCount"] == len(members), row["id"] + " count")

    reset = by_id["LIFE10"]
    require(sum(entry["delta"] for entry in reset["expected"]["chipLedger"]) == reset["expected"]["netLedgerDelta"] == 0, "LIFE10 reset ledger")
    require(sum(reset["given"]["stacks"].values()) == sum(reset["expected"]["finalStacks"].values()), "LIFE10 total")
    leaving = by_id["LIFE04"]
    require(sum(leaving["expected"]["remainingStacks"].values()) - sum(entry["delta"] for entry in leaving["expected"]["chipLedger"]) == sum(leaving["given"]["contributions"].values()), "LIFE04 cashout ledger")

    documents = [APP_ROOT / f"docs/{name}.md" for name in ["product-rules", "decisions", "user-flows"]]
    documents.append(APP_ROOT / "tests/fixtures/README.md")
    for path in documents:
        text = path.read_text(encoding="utf-8")
        require("\ufffd" not in text, str(path) + " encoding")
        require(len(re.findall(r"^```", text, re.M)) % 2 == 0, str(path) + " unbalanced fence")
        for target in re.findall(r"\]\(([^)]+)\)", text):
            if not target.startswith(("https://", "http://")):
                require((path.parent / target).is_file(), str(path) + " broken link: " + target)
    stories = (APP_ROOT / "docs/user-flows.md").read_text(encoding="utf-8")
    require(len(re.findall(r"^## U\d{2}：", stories, re.M)) == 12, "Expected 12 stories")
    referenced_ids = set(re.findall(r"\b(?:[CEOBSPI]\d{2}|ROOM\d{2}|LIFE\d{2}|PRIV\d{2}|RANK\d{2})\b", stories))
    require(referenced_ids <= set(ids), "Unknown scenario in stories")
    decisions = (APP_ROOT / "docs/decisions.md").read_text(encoding="utf-8")
    require(len(re.findall(r"^## R\d{2}：", decisions, re.M)) == 10, "Expected 10 decisions")
    files = [FIXTURE_PATH, *documents, Path(__file__).resolve()]
    return {
        "status": "passed",
        "baselineDate": "2026-10-30",
        "scope": "W01 document and fixture audit only",
        "scenarioCount": len(rows),
        "groups": {"core": 41, "supplementalRanks": 4, "room": 13, "lifecycle": 12, "privacy": 4},
        "userStories": 12,
        "boundaryDecisions": 10,
        "checks": ["strict JSON and unique keys", "74 unique IDs and 41 core IDs", "required fields", "provenance paths", "fixed deals for 2/3/4 seats", "shuffle stub fact", "nine hand category facts and kickers", "compatible settlement cards", "seven pot/refund/payout arithmetic facts", "call and raise arithmetic", "B04/B09 responsive opponent premises", "passive hand fixture amounts", "room capacities", "reset and cashout ledger arithmetic", "document links and references"],
        "applicationRuleTestsRun": False,
        "propertySimulationsRun": False,
        "networkTestsRun": False,
        "sha256": {str(path.relative_to(APP_ROOT)).replace("\\", "/"): hashlib.sha256(path.read_bytes()).hexdigest() for path in files},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    try:
        report = audit()
    except (ValueError, KeyError, TypeError, OSError, StopIteration) as exc:
        failure = {"status": "failed", "error": str(exc)}
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps(failure, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(failure, ensure_ascii=True))
        return 1
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "sha256"}, ensure_ascii=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
