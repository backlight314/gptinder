import json
import logging

import pytest

from app.whatsapp_parser import WhatsAppParseError, detect_date_order, parse_whatsapp_export

USER, OTHER, THIRD = "Sam Rivera", "Jordan Lee", "Priya Shah"
LEAK = "ZQX-OTHER"  # marks every line that belongs to someone else; it must appear nowhere in any output

IPHONE = "\n".join(
    [
        "‎[25/02/2024, 18:04:00] Messages and calls are end-to-end encrypted. No one outside of this chat can read them.",
        "[25/02/2024, 18:05:11] Sam Rivera: hey are we still on for saturday?",
        f"[25/02/2024, 18:06:40] Jordan Lee: {LEAK}-1 yes bringing snacks",
        f"and this continues {LEAK}-2",
        "‎[25/02/2024, 18:07:02] Sam Rivera: great",
        "second line of mine",
        "",
        "third line after a blank line",
        "‎[25/02/2024, 18:07:30] Jordan Lee: ‎image omitted",
        "[25/02/2024, 18:08:00] Sam Rivera: <Media omitted>",
        '[25/02/2024, 18:09:00] Sam Rivera changed the subject to "Trip"',
        f"[25/02/2024, 18:09:30] Jordan Lee changed the group description: {LEAK}-3",
        "[25/02/2024, 18:10:00] Sam Rivera: see you then <This message was edited>",
        "[25/02/2024, 18:11:00] Sam Rivera: This message was deleted",
        "[25/02/2024, 18:12:00] Sam Rivera: You deleted this message",
        "[25/02/2024, 18:13:00] Priya Shah: " + f"{LEAK}-4 a third person in a group chat",
    ]
)


def contents(parsed):
    return [m["content"] for m in parsed.messages]


def test_iphone_format_keeps_only_own_messages_and_drops_system_media_deleted_and_edited_markers():
    parsed = parse_whatsapp_export(IPHONE, USER)
    assert parsed.messages == [
        {"content": "hey are we still on for saturday?", "timestamp": "2024-02-25T18:05:11+00:00"},
        {"content": "great\nsecond line of mine\n\nthird line after a blank line", "timestamp": "2024-02-25T18:07:02+00:00"},
        {"content": "see you then", "timestamp": "2024-02-25T18:10:00+00:00"},
    ]
    assert all("message_id" not in m for m in parsed.messages)
    assert (parsed.date_order, parsed.date_order_guessed) == ("dmy", False)


def test_android_format():
    text = "\n".join(
        [
            "25/02/2024, 18:05 - Sam Rivera: hi from android",
            f"25/02/2024, 18:06 - Jordan Lee: {LEAK}-1",
            "25/02/2024, 18:07 - Messages and calls are end-to-end encrypted.",
            "25/02/2024, 18:08 - Sam Rivera: second",
            "with a continuation line",
        ]
    )
    assert parse_whatsapp_export(text, USER).messages == [
        {"content": "hi from android", "timestamp": "2024-02-25T18:05:00+00:00"},
        {"content": "second\nwith a continuation line", "timestamp": "2024-02-25T18:08:00+00:00"},
    ]


def test_iphone_12h_clock_with_narrow_no_break_space_and_two_digit_year():
    text = "[2/25/24, 6:05:11 PM] Sam Rivera: evening\n[2/26/24, 12:30:00 AM] Sam Rivera: just after midnight\n"
    parsed = parse_whatsapp_export(text, USER)
    assert [m["timestamp"] for m in parsed.messages] == ["2024-02-25T18:05:11+00:00", "2024-02-26T00:30:00+00:00"]
    assert parsed.date_order == "mdy"


def test_android_12h_lowercase_and_noon():
    text = "25/02/2024, 6:05 pm - Sam Rivera: a\n25/02/2024, 12:30 pm - Sam Rivera: b\n25/02/2024, 12:30 am - Sam Rivera: c\n"
    assert [m["timestamp"][11:16] for m in parse_whatsapp_export(text, USER).messages] == ["18:05", "12:30", "00:30"]


def test_day_first_is_inferred_from_a_first_number_above_12():
    parsed = parse_whatsapp_export("[03/04/2024, 10:00:00] Sam Rivera: early\n[25/04/2024, 10:00:00] Sam Rivera: late\n", USER)
    assert [m["timestamp"][:10] for m in parsed.messages] == ["2024-04-03", "2024-04-25"]
    assert (parsed.date_order, parsed.date_order_guessed) == ("dmy", False)


def test_month_first_is_inferred_from_a_second_number_above_12():
    parsed = parse_whatsapp_export("[04/03/2024, 10:00:00] Sam Rivera: early\n[04/25/2024, 10:00:00] Sam Rivera: late\n", USER)
    assert [m["timestamp"][:10] for m in parsed.messages] == ["2024-04-03", "2024-04-25"]
    assert (parsed.date_order, parsed.date_order_guessed) == ("mdy", False)


def test_an_ambiguous_file_defaults_to_day_first_and_says_it_guessed_and_the_override_wins():
    text = "[03/04/2024, 10:00:00] Sam Rivera: only ambiguous dates\n"
    guessed = parse_whatsapp_export(text, USER)
    assert guessed.messages[0]["timestamp"][:10] == "2024-04-03" and guessed.date_order_guessed is True
    assert detect_date_order(text) is None
    forced = parse_whatsapp_export(text, USER, date_order="mdy")
    assert forced.messages[0]["timestamp"][:10] == "2024-03-04"
    assert (forced.date_order, forced.date_order_guessed) == ("mdy", False)


def test_override_beats_inference_and_bad_override_is_rejected():
    assert parse_whatsapp_export("[25/02/2024, 10:00:00] Sam Rivera: x\n", USER, date_order="dmy").date_order == "dmy"
    with pytest.raises(WhatsAppParseError):
        parse_whatsapp_export("[25/02/2024, 10:00:00] Sam Rivera: x\n", USER, date_order="ymd")


def test_conflicting_date_evidence_is_an_error():
    text = "[25/02/2024, 10:00:00] Sam Rivera: a\n[02/25/2024, 10:00:00] Sam Rivera: b\n"
    with pytest.raises(WhatsAppParseError, match="mixes day-first and month-first"):
        parse_whatsapp_export(text, USER)


def test_year_first_dates():
    parsed = parse_whatsapp_export("[2024-02-25, 18:05:11] Sam Rivera: iso style\n", USER)
    assert parsed.messages[0]["timestamp"] == "2024-02-25T18:05:11+00:00"


def test_an_impossible_date_is_not_a_message_header():
    text = f"[25/02/2024, 10:00:00] Jordan Lee: {LEAK}-1\n[31/02/2024, 10:00:00] Sam Rivera: not attributed\n[26/02/2024, 10:00:00] Sam Rivera: real\n"
    assert contents(parse_whatsapp_export(text, USER)) == ["real"]


def test_group_chat_with_three_people_keeps_only_the_user():
    text = "\n".join(
        [f"[25/02/2024, 10:0{i}:00] {who}: {LEAK if who != USER else 'mine'} {i}" for i, who in enumerate([USER, OTHER, THIRD, USER, OTHER])]
    )
    assert contents(parse_whatsapp_export(text, USER)) == ["mine 0", "mine 3"]


def test_name_matching_ignores_case_spacing_isolates_tilde_and_phone_formatting():
    for display, sender in [
        ("  sam   RIVERA ", "Sam Rivera"),
        ("Sam Rivera", "⁨Sam Rivera⁩"),
        ("Sam Rivera", "~ Sam Rivera"),
        ("+447700900123", "+44 7700 900123"),
    ]:
        text = f"[25/02/2024, 10:00:00] {sender}: hello\n[25/02/2024, 10:01:00] {OTHER}: {LEAK}\n"
        assert contents(parse_whatsapp_export(text, display)) == ["hello"], (display, sender)


def test_a_partial_name_does_not_match_someone_else():
    text = f"[25/02/2024, 10:00:00] Sam Rivera-Jones: {LEAK}\n[25/02/2024, 10:01:00] Sam Rivera: mine\n"
    assert contents(parse_whatsapp_export(text, "Sam Rivera")) == ["mine"]


def test_an_unknown_name_raises_a_clear_error_that_lists_no_other_senders_or_text():
    with pytest.raises(WhatsAppParseError) as exc:
        parse_whatsapp_export(IPHONE, "Nobody Here")
    message = str(exc.value)
    assert "Nobody Here" in message and "exactly as WhatsApp shows it" in message
    assert not any(x in message for x in (OTHER, THIRD, USER, LEAK))


def test_only_media_and_deleted_messages_is_an_error():
    text = "[25/02/2024, 10:00:00] Sam Rivera: <Media omitted>\n[25/02/2024, 10:01:00] Sam Rivera: This message was deleted\n"
    with pytest.raises(WhatsAppParseError, match="no text messages"):
        parse_whatsapp_export(text, USER)


@pytest.mark.parametrize("text", ["", "just some words\nwith no timestamps at all", "hello: world"])
def test_text_that_is_not_a_whatsapp_export_is_an_error(text):
    with pytest.raises(WhatsAppParseError, match="No WhatsApp messages were found"):
        parse_whatsapp_export(text, USER)


def test_a_blank_display_name_is_rejected():
    with pytest.raises(WhatsAppParseError):
        parse_whatsapp_export(IPHONE, "   ")


def test_other_participants_text_and_names_appear_nowhere_in_the_output_or_the_logs(caplog):
    with caplog.at_level(logging.DEBUG):
        parsed = parse_whatsapp_export(IPHONE, USER)
        with pytest.raises(WhatsAppParseError):
            parse_whatsapp_export(IPHONE, "Nobody Here")
    everything = json.dumps(parsed.messages) + repr(parsed) + caplog.text
    assert LEAK not in everything
    assert OTHER not in everything and THIRD not in everything
