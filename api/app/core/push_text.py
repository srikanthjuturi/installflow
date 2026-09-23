"""What a push notification says, in the language of the phone it lands on.

The technician app speaks English, Hindi, Telugu, Kannada and Tamil, and each
phone tells us which one it is showing when it registers its push token
(`push_tokens.language`). A push is the one piece of the app's wording the
phone cannot translate itself: when the app is closed, Android draws the
title and body exactly as this server sent them. So they are written here.

## A message is a key and its values, not a sentence

Callers build a `PushText` — `PushText("job.assigned", code=..., place=...,
when=Slot(start, end))` — and `push.send_to_technicians` renders it once per
language among the recipients' phones. Nothing is worded before the language
is known, for the same reason the app words dates at render: a sentence built
early is a sentence in the wrong language.

Values that read differently per language are small wrapper types — `Slot`,
`Clock`, `TimeToSlot` — resolved at render. Everything else is shown as given:
job codes, city and pincode, rupee amounts, the product's catalogue name, a
UPI ID, and anything a person TYPED (a decline reason). Those are data, and the
app does not translate them either.

## English is unchanged, character for character

Every English template below is the sentence the call site used to build
inline, and the English day and clock still come from `slots.when_label` and
`slots.clock`. The other languages keep AM/PM, digits, ₹ and job codes as they
are — the app's own wording rules (`mobileapp/src/i18n/README.md`), whose
glossary these translations follow.

## Drift fails at import

`_check()` runs when this module loads: every message must exist in every
language with exactly English's `{placeholders}`. CI imports `app.main`, so a
translation that dropped `{code}` fails the pull request instead of raising a
KeyError inside a sweep, where nobody would see it.
"""

import datetime
import string
from dataclasses import dataclass
from typing import Mapping

from app.core.slots import IST, clock, clock_range, when_label

LANGUAGES = ("en", "hi", "te", "kn", "ta")
DEFAULT_LANGUAGE = "en"


def normalize_language(value: str | None) -> str:
    """The language to write in, from whatever a phone sent.

    Unknown is English, never an error: a later app version may add a
    language this server has not learned yet, and refusing its registration
    would silently stop every notification to that phone.
    """
    value = (value or "").strip().lower()
    return value if value in LANGUAGES else DEFAULT_LANGUAGE


# ── values that change with the language ─────────────────────────────────────


@dataclass(frozen=True)
class Slot:
    """A booked window — `Thu 21 Aug, 10:00 AM–12:00 PM` — or, with no
    window yet, the language's "time to be confirmed"."""

    start: datetime.datetime | None
    end: datetime.datetime | None


@dataclass(frozen=True)
class Clock:
    """One instant as `2:00 PM`, in IST."""

    at: datetime.datetime


@dataclass(frozen=True)
class TimeToSlot:
    """`2h 40m to slot`, or `no slot` — how long until the window opens."""

    at: datetime.datetime | None


# Day and month names per language, in the app's own order and spelling
# (`dates.weekdaysShort` — Sunday first — and `dates.monthsShort` in
# mobileapp/src/i18n/locales). English is absent: it keeps `slots.day_label`.
_WEEKDAYS = {
    "hi": ("रवि", "सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि"),
    "te": ("ఆది", "సోమ", "మంగళ", "బుధ", "గురు", "శుక్ర", "శని"),
    "kn": ("ಭಾನು", "ಸೋಮ", "ಮಂಗಳ", "ಬುಧ", "ಗುರು", "ಶುಕ್ರ", "ಶನಿ"),
    "ta": ("ஞாயி.", "திங்.", "செவ்.", "புத.", "வியா.", "வெள்.", "சனி"),
}
_MONTHS = {
    "hi": ("जन॰", "फ़र॰", "मार्च", "अप्रैल", "मई", "जून", "जुल॰", "अग॰", "सित॰", "अक्तू॰", "नव॰", "दिस॰"),
    "te": ("జన", "ఫిబ్ర", "మార్చి", "ఏప్రి", "మే", "జూన్", "జులై", "ఆగ", "సెప్టెం", "అక్టో", "నవం", "డిసెం"),
    "kn": ("ಜನ", "ಫೆಬ್ರ", "ಮಾರ್ಚ್", "ಏಪ್ರಿ", "ಮೇ", "ಜೂನ್", "ಜುಲೈ", "ಆಗ", "ಸೆಪ್ಟೆಂ", "ಅಕ್ಟೋ", "ನವೆಂ", "ಡಿಸೆಂ"),
    "ta": ("ஜன.", "பிப்.", "மார்.", "ஏப்.", "மே", "ஜூன்", "ஜூலை", "ஆக.", "செப்.", "அக்.", "நவ.", "டிச."),
}

# The small phrases a value renders into.
_PHRASES: dict[str, dict[str, str]] = {
    "en": {
        "tbc": "time to be confirmed",
        "no_slot": "no slot",
        "span": "{h}h {m:02d}m",
        "to_slot": "{span} to slot",
    },
    "hi": {
        "tbc": "समय अभी तय नहीं",
        "no_slot": "समय तय नहीं",
        "span": "{h} घंटे {m:02d} मिनट",
        "to_slot": "समय में {span} बाकी",
    },
    "te": {
        "tbc": "సమయం ఇంకా నిర్ణయించలేదు",
        "no_slot": "సమయం ఇంకా లేదు",
        "span": "{h} గం. {m:02d} ని.",
        "to_slot": "సమయానికి ఇంకా {span}",
    },
    "kn": {
        "tbc": "ಸಮಯ ಇನ್ನೂ ನಿಗದಿಯಾಗಿಲ್ಲ",
        "no_slot": "ಸಮಯ ಬಾಕಿ",
        "span": "{h} ಗಂ {m:02d} ನಿ",
        "to_slot": "ಸಮಯಕ್ಕೆ ಇನ್ನೂ {span}",
    },
    "ta": {
        "tbc": "நேரம் இன்னும் அமைக்கப்படவில்லை",
        "no_slot": "இன்னும் நேரம் இல்லை",
        "span": "{h} மணி {m:02d} நிமி.",
        "to_slot": "நேரத்துக்கு இன்னும் {span}",
    },
}


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _render_value(value: object, lang: str) -> object:
    words = _PHRASES[lang]
    if isinstance(value, Slot):
        if value.start is None or value.end is None:
            return words["tbc"]
        if lang == "en":
            return when_label(value.start, value.end)
        local = value.start.astimezone(IST)
        day = f"{_WEEKDAYS[lang][(local.weekday() + 1) % 7]} {local.day} {_MONTHS[lang][local.month - 1]}"
        return f"{day}, {clock_range(value.start, value.end)}"
    if isinstance(value, Clock):
        hm, meridiem = clock(value.at)
        return f"{hm} {meridiem}"
    if isinstance(value, TimeToSlot):
        # The same arithmetic as `escalation.time_to_slot`, so English reads
        # exactly as that did; not imported, because escalation pulls in the
        # WhatsApp and notification machinery and this module must stay leaf.
        if value.at is None:
            return words["no_slot"]
        minutes = max(0, int((value.at - _now()).total_seconds() // 60))
        span = words["span"].format(h=minutes // 60, m=minutes % 60)
        return words["to_slot"].format(span=span)
    return value


# ── the messages ─────────────────────────────────────────────────────────────
#
# (title, body) per language. `{place}` is "{city} {pincode}", `{amount}` an
# already-formatted rupee figure, `{reason}` whatever a manager or payer typed.

MESSAGES: dict[str, dict[str, tuple[str, str]]] = {
    # A job entered the pool. `{summary}` is "₹450 · OLED · Pune 411001" —
    # money, product, place — none of which is words to translate.
    "pool.new": {
        "en": ("New job in your area", "{summary}"),
        "hi": ("आपके इलाके में नया काम", "{summary}"),
        "te": ("మీ ఏరియాలో కొత్త పని", "{summary}"),
        "kn": ("ನಿಮ್ಮ ಏರಿಯಾದಲ್ಲಿ ಹೊಸ ಕೆಲಸ", "{summary}"),
        "ta": ("உங்கள் பகுதியில் புதிய வேலை", "{summary}"),
    },
    # Shortly before the slot. The job code opens the title so it is never
    # followed by a case ending the code cannot take.
    "slot.reminder": {
        "en": ("{code} starts at {time}", "{place} · {to_slot}"),
        "hi": ("{code} शुरू होने का समय: {time}", "{place} · {to_slot}"),
        "te": ("{code} ప్రారంభ సమయం: {time}", "{place} · {to_slot}"),
        "kn": ("{code} ಆರಂಭ ಸಮಯ: {time}", "{place} · {to_slot}"),
        "ta": ("{code} தொடங்கும் நேரம்: {time}", "{place} · {to_slot}"),
    },
    "job.assigned": {
        "en": ("{code} assigned to you", "{place} · {when}"),
        "hi": ("{code} आपको सौंपा गया", "{place} · {when}"),
        "te": ("{code} మీకు ఇవ్వబడింది", "{place} · {when}"),
        "kn": ("{code} ನಿಮಗೆ ನೀಡಲಾಗಿದೆ", "{place} · {when}"),
        "ta": ("{code} உங்களுக்கு ஒதுக்கப்பட்டது", "{place} · {when}"),
    },
    "job.rescheduled": {
        "en": ("{code} moved to {when}", "{place} · rescheduled by your manager"),
        "hi": ("{code} का नया समय: {when}", "{place} · आपके मैनेजर ने समय बदला"),
        "te": ("{code} కొత్త సమయం: {when}", "{place} · మీ మేనేజర్ సమయం మార్చారు"),
        "kn": ("{code} ಹೊಸ ಸಮಯ: {when}", "{place} · ನಿಮ್ಮ ಮ್ಯಾನೇಜರ್ ಸಮಯ ಬದಲಾಯಿಸಿದ್ದಾರೆ"),
        "ta": ("{code} புதிய நேரம்: {when}", "{place} · உங்கள் மேனேஜர் நேரத்தை மாற்றினார்"),
    },
    "penalty.reversed": {
        "en": ("{code}: penalty reversed", "The {amount} penalty for {code} has been reversed."),
        "hi": ("{code}: जुर्माना हटाया गया", "{code} का {amount} जुर्माना हटा दिया गया है।"),
        "te": ("{code}: జరిమానా రద్దు", "{code} పనికి వేసిన {amount} జరిమానాను రద్దు చేశారు."),
        "kn": ("{code}: ದಂಡ ರದ್ದು", "{code} ಕೆಲಸಕ್ಕೆ ವಿಧಿಸಿದ್ದ {amount} ದಂಡವನ್ನು ರದ್ದುಪಡಿಸಲಾಗಿದೆ."),
        "ta": ("{code}: அபராதம் ரத்து", "{code} வேலைக்கான {amount} அபராதம் ரத்துசெய்யப்பட்டது."),
    },
    "job.forceClosed": {
        "en": (
            "{code} closed by the office",
            "The customer never responded, so a manager closed this job. It counts as completed.",
        ),
        "hi": (
            "{code} ऑफ़िस ने बंद किया",
            "ग्राहक ने जवाब नहीं दिया, इसलिए मैनेजर ने यह काम बंद कर दिया। इसे पूरा हुआ काम माना जाएगा।",
        ),
        "te": (
            "{code} ఆఫీస్ ముగించింది",
            "కస్టమర్ స్పందించలేదు, అందుకే మేనేజర్ ఈ పనిని ముగించారు. ఇది పూర్తయిన పనిగానే లెక్కలోకి వస్తుంది.",
        ),
        "kn": (
            "{code} ಕಚೇರಿಯಿಂದ ಮುಕ್ತಾಯ",
            "ಗ್ರಾಹಕರು ಉತ್ತರಿಸಲಿಲ್ಲ, ಹಾಗಾಗಿ ಮ್ಯಾನೇಜರ್ ಈ ಕೆಲಸವನ್ನು ಮುಕ್ತಾಯಗೊಳಿಸಿದ್ದಾರೆ. ಇದನ್ನು ಪೂರ್ಣಗೊಂಡ ಕೆಲಸವೆಂದೇ ಪರಿಗಣಿಸಲಾಗುತ್ತದೆ.",
        ),
        "ta": (
            "{code} அலுவலகத்தால் முடிக்கப்பட்டது",
            "வாடிக்கையாளர் பதிலளிக்கவில்லை, அதனால் மேனேஜர் இந்த வேலையை முடித்தார். இது முடிந்த வேலையாகவே கணக்கிடப்படும்.",
        ),
    },
    # The customer confirmed, with no rating — "rated 0" would be invented.
    "job.closed": {
        "en": ("{code} closed", "The customer confirmed the installation. Nice work."),
        "hi": ("{code} पूरा हुआ", "ग्राहक ने इंस्टॉलेशन की पुष्टि कर दी। बढ़िया काम!"),
        "te": ("{code} పూర్తయింది", "కస్టమర్ ఇన్‌స్టాలేషన్‌ను కన్ఫర్మ్ చేశారు. బాగా చేశారు!"),
        "kn": ("{code} ಮುಕ್ತಾಯ", "ಗ್ರಾಹಕರು ಇನ್‌ಸ್ಟಾಲೇಶನ್ ಖಚಿತಪಡಿಸಿದ್ದಾರೆ. ಒಳ್ಳೆಯ ಕೆಲಸ!"),
        "ta": ("{code} முடிந்தது", "வாடிக்கையாளர் இன்ஸ்டாலேஷனை உறுதிசெய்தார். சிறப்பான வேலை!"),
    },
    "job.closedRated": {
        "en": ("{code} closed", "The customer confirmed it and rated you {rating}/5."),
        "hi": ("{code} पूरा हुआ", "ग्राहक ने पुष्टि की और आपको {rating}/5 रेटिंग दी।"),
        "te": ("{code} పూర్తయింది", "కస్టమర్ కన్ఫర్మ్ చేసి మీకు {rating}/5 రేటింగ్ ఇచ్చారు."),
        "kn": ("{code} ಮುಕ್ತಾಯ", "ಗ್ರಾಹಕರು ಖಚಿತಪಡಿಸಿ ನಿಮಗೆ {rating}/5 ರೇಟಿಂಗ್ ನೀಡಿದ್ದಾರೆ."),
        "ta": ("{code} முடிந்தது", "வாடிக்கையாளர் உறுதிசெய்து உங்களுக்கு {rating}/5 மதிப்பீடு அளித்தார்."),
    },
    "job.refused": {
        "en": (
            "{code}: the customer says it is not finished",
            "A manager will be in touch. Do not return to site until they call.",
        ),
        "hi": (
            "{code}: ग्राहक के मुताबिक काम अधूरा है",
            "मैनेजर आपसे संपर्क करेंगे। उनका कॉल आने तक साइट पर वापस न जाएँ।",
        ),
        "te": (
            "{code}: పని పూర్తి కాలేదని కస్టమర్ అంటున్నారు",
            "మేనేజర్ మిమ్మల్ని సంప్రదిస్తారు. వారు కాల్ చేసే వరకు సైట్‌కు తిరిగి వెళ్లకండి.",
        ),
        "kn": (
            "{code}: ಗ್ರಾಹಕರ ಪ್ರಕಾರ ಕೆಲಸ ಮುಗಿದಿಲ್ಲ",
            "ಮ್ಯಾನೇಜರ್ ನಿಮ್ಮನ್ನು ಸಂಪರ್ಕಿಸುತ್ತಾರೆ. ಅವರು ಕರೆ ಮಾಡುವವರೆಗೆ ಸೈಟ್‌ಗೆ ಮತ್ತೆ ಹೋಗಬೇಡಿ.",
        ),
        "ta": (
            "{code}: வேலை முடியவில்லை என்கிறார் வாடிக்கையாளர்",
            "மேனேஜர் உங்களைத் தொடர்புகொள்வார். அவர் அழைக்கும் வரை இடத்துக்குத் திரும்பிச் செல்ல வேண்டாம்.",
        ),
    },
    "redemption.paid": {
        "en": ("{amount} paid to your UPI", "Check your bank app and confirm you received it."),
        "hi": ("आपके UPI पर {amount} भेजे गए", "अपना बैंक ऐप देखें और मिलने की पुष्टि करें।"),
        "te": ("మీ UPIకి {amount} చెల్లించారు", "మీ బ్యాంక్ యాప్ చూసి, మీకు అందిందని కన్ఫర్మ్ చేయండి."),
        "kn": ("ನಿಮ್ಮ UPI ಗೆ {amount} ಪಾವತಿಸಲಾಗಿದೆ", "ನಿಮ್ಮ ಬ್ಯಾಂಕ್ ಆಪ್ ನೋಡಿ, ಹಣ ಬಂದಿದೆಯೇ ಎಂದು ಖಚಿತಪಡಿಸಿ."),
        "ta": ("உங்கள் UPI-க்கு {amount} செலுத்தப்பட்டது", "உங்கள் வங்கி ஆப்பைப் பார்த்து, கிடைத்ததை உறுதிசெய்யவும்."),
    },
    # The body is the payer's own words, shown as typed.
    "redemption.declined": {
        "en": ("Redemption declined", "{reason}"),
        "hi": ("रिडीम रिक्वेस्ट नामंज़ूर", "{reason}"),
        "te": ("రీడీమ్ రిక్వెస్ట్ తిరస్కరించారు", "{reason}"),
        "kn": ("ರಿಡೀಮ್ ವಿನಂತಿ ನಿರಾಕರಿಸಲಾಗಿದೆ", "{reason}"),
        "ta": ("ரிடீம் கோரிக்கை மறுக்கப்பட்டது", "{reason}"),
    },
    "upi.approved": {
        "en": ("UPI ID changed", "Your earnings now go to {upi_id}."),
        "hi": ("UPI ID बदल गई", "अब आपकी कमाई {upi_id} पर भेजी जाएगी।"),
        "te": ("UPI ID మారింది", "ఇకపై మీ సంపాదన {upi_id}కు జమ అవుతుంది."),
        "kn": ("UPI ID ಬದಲಾಗಿದೆ", "ಇನ್ನು ಮುಂದೆ ನಿಮ್ಮ ಗಳಿಕೆ {upi_id} ಗೆ ಜಮೆಯಾಗುತ್ತದೆ."),
        "ta": ("UPI ID மாற்றப்பட்டது", "இனி உங்கள் வருமானம் {upi_id} UPI ID-க்குச் செலுத்தப்படும்."),
    },
    # The manager's own words, shown as typed.
    "upi.rejected": {
        "en": ("UPI ID change not approved", "{reason}"),
        "hi": ("UPI ID बदलने की रिक्वेस्ट मंज़ूर नहीं", "{reason}"),
        "te": ("UPI ID మార్పు ఆమోదం పొందలేదు", "{reason}"),
        "kn": ("UPI ID ಬದಲಾವಣೆಗೆ ಒಪ್ಪಿಗೆ ಸಿಕ್ಕಿಲ್ಲ", "{reason}"),
        "ta": ("UPI ID மாற்றத்துக்கு ஒப்புதல் இல்லை", "{reason}"),
    },
    # …and for a rejection that somehow arrived without any.
    "upi.rejectedNoReason": {
        "en": ("UPI ID change not approved", "Your manager did not approve the change."),
        "hi": ("UPI ID बदलने की रिक्वेस्ट मंज़ूर नहीं", "आपके मैनेजर ने बदलाव मंज़ूर नहीं किया।"),
        "te": ("UPI ID మార్పు ఆమోదం పొందలేదు", "మీ మేనేజర్ ఈ మార్పును ఆమోదించలేదు."),
        "kn": ("UPI ID ಬದಲಾವಣೆಗೆ ಒಪ್ಪಿಗೆ ಸಿಕ್ಕಿಲ್ಲ", "ನಿಮ್ಮ ಮ್ಯಾನೇಜರ್ ಈ ಬದಲಾವಣೆಗೆ ಒಪ್ಪಿಗೆ ನೀಡಿಲ್ಲ."),
        "ta": ("UPI ID மாற்றத்துக்கு ஒப்புதல் இல்லை", "உங்கள் மேனேஜர் இந்த மாற்றத்துக்கு ஒப்புதல் அளிக்கவில்லை."),
    },
}


class PushText:
    """One notification, not yet worded. See the module note.

    An unknown key raises HERE, at the call site, rather than in the sender —
    where the failure would be swallowed with every other push error.
    """

    __slots__ = ("key", "params")

    def __init__(self, key: str, **params: object) -> None:
        if key not in MESSAGES:
            raise KeyError(f"No push message {key!r}")
        self.key = key
        self.params: Mapping[str, object] = params

    def render(self, language: str) -> tuple[str, str]:
        """`(title, body)` in `language` — English for one this server lacks."""
        lang = normalize_language(language)
        title, body = MESSAGES[self.key][lang]
        values = {name: _render_value(value, lang) for name, value in self.params.items()}
        return title.format(**values), body.format(**values)


def _fields(template: str) -> set[str]:
    return {name for _, name, _, _ in string.Formatter().parse(template) if name}


def _check() -> None:
    for lang, words in _PHRASES.items():
        if set(words) != set(_PHRASES["en"]):
            raise RuntimeError(f"push_text: {lang} phrases differ from English")
    for lang in LANGUAGES[1:]:
        if len(_WEEKDAYS[lang]) != 7 or len(_MONTHS[lang]) != 12:
            raise RuntimeError(f"push_text: {lang} day or month names are incomplete")
    for key, by_lang in MESSAGES.items():
        if set(by_lang) != set(LANGUAGES):
            raise RuntimeError(f"push_text: {key} is missing a language")
        en_title, en_body = by_lang["en"]
        for lang, (title, body) in by_lang.items():
            if not title.strip() or not body.strip():
                raise RuntimeError(f"push_text: {key}/{lang} is empty")
            if _fields(title) | _fields(body) != _fields(en_title) | _fields(en_body):
                raise RuntimeError(f"push_text: {key}/{lang} placeholders differ from English")


_check()
