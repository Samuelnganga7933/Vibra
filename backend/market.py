"""Locale → market queries for discovery.

The browser sends its initial locale (``navigator.language``, e.g. ``ko-KR``)
on the discovery endpoints; this module turns it into engine queries that are
aligned with that market. Nothing here fixes one language: the territory and
language subtags pick the country and scene dynamically, and the generic
queries always stay in the blend so an unknown locale still fills its shelves.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional

from catalogue import search_catalogue

# Territory code → market name used in "popular in {market}" searches.
_TERRITORIES: dict[str, str] = {
    "AR": "Argentina", "AT": "Austria", "AU": "Australia", "BE": "Belgium",
    "BG": "Bulgaria", "BR": "Brazil", "CA": "Canada", "CH": "Switzerland",
    "CL": "Chile", "CO": "Colombia", "CZ": "Czech Republic", "DE": "Germany",
    "DK": "Denmark", "EG": "Egypt", "ES": "Spain", "FI": "Finland",
    "FR": "France", "GB": "the UK", "GH": "Ghana", "GR": "Greece",
    "HK": "Hong Kong", "HU": "Hungary", "ID": "Indonesia", "IE": "Ireland",
    "IL": "Israel", "IN": "India", "IS": "Iceland", "IT": "Italy",
    "JP": "Japan", "KE": "Kenya", "KR": "South Korea", "MA": "Morocco",
    "MX": "Mexico", "MY": "Malaysia", "NG": "Nigeria", "NL": "the Netherlands",
    "NO": "Norway", "NZ": "New Zealand", "PE": "Peru", "PH": "the Philippines",
    "PK": "Pakistan", "PL": "Poland", "PT": "Portugal", "RO": "Romania",
    "RS": "Serbia", "RU": "Russia", "SA": "Saudi Arabia", "SE": "Sweden",
    "SG": "Singapore", "SI": "Slovenia", "SK": "Slovakia", "TH": "Thailand",
    "TR": "Turkey", "TW": "Taiwan", "TZ": "Tanzania", "UA": "Ukraine",
    "UG": "Uganda", "US": "the US", "VN": "Vietnam", "ZA": "South Africa",
}

# Language subtag → market, only for the unambiguous language-only locales
# (values without a territory, e.g. plain "de").
_LANGUAGE_MARKETS: dict[str, str] = {
    "ar": "Egypt", "de": "Germany", "en": "Kenya", "es": "Spain",
    "fi": "Finland", "fr": "France", "hi": "India", "id": "Indonesia",
    "it": "Italy", "ja": "Japan", "ko": "South Korea", "ms": "Malaysia",
    "nl": "Netherlands", "pl": "Poland", "pt": "Brazil", "sv": "Sweden",
    "sw": "Kenya", "th": "Thailand", "tr": "Turkey", "vi": "Vietnam",
    "zh": "China",
}

# Language subtag → a music scene that charts in that language. Used as a
# secondary query so first-run trending reflects the locale's sound, not only
# its geography.
_LANGUAGE_SCENES: dict[str, str] = {
    "ar": "arabic music", "de": "german music", "es": "latin music",
    "fr": "french music", "hi": "bollywood", "id": "indonesian music",
    "ja": "j-pop", "ko": "kpop", "pt": "brazilian music",
    "th": "thai music", "tr": "turkish music", "zh": "mandarin pop",
}

# Vibra's home market — the shelf when a locale carries no usable signal.
DEFAULT_MARKET = "Kenya"


def parse_locale(locale: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """(territory, language) from a BCP-47-ish tag; ("ko-KR" → ("KR", "ko"))."""
    if not locale or not locale.strip():
        return None, None
    parts = locale.strip().replace("_", "-").split("-")
    language = parts[0].lower() if parts and parts[0].isalpha() else None
    territory = None
    for part in parts[1:]:
        if len(part) == 2 and part.isalpha():
            territory = part.upper()
            break
    return territory, language


def market_label(locale: Optional[str]) -> str:
    """Market name for a locale — "Popular in {market}" shelves use this."""
    territory, language = parse_locale(locale)
    if territory and territory in _TERRITORIES:
        return _TERRITORIES[territory]
    if language and language in _LANGUAGE_MARKETS:
        return _LANGUAGE_MARKETS[language]
    return DEFAULT_MARKET


def region_query(locale: Optional[str]) -> str:
    """The chart query behind the "Popular in {market}" shelf.

    "{market} top songs" is deliberately music-scoped: loose phrasings like
    "popular in South Korea" drag news, travel and language lessons in.
    """
    return f"{market_label(locale)} top songs"


def scene_queries(locale: Optional[str]) -> list[str]:
    """Language music-scene queries for a locale (e.g. ko → kpop); [] when none."""
    _, language = parse_locale(locale)
    if language and language in _LANGUAGE_SCENES:
        return [_LANGUAGE_SCENES[language]]
    return []


def market_queries(locale: Optional[str]) -> list[str]:
    """Ordered, market-aligned engine queries for a locale (may be empty)."""
    territory, language = parse_locale(locale)
    queries: list[str] = []
    market = _TERRITORIES.get(territory) if territory else _LANGUAGE_MARKETS.get(language)
    if market:
        queries.append(f"{market} top songs")
    if language and language in _LANGUAGE_SCENES:
        queries.append(_LANGUAGE_SCENES[language])
    return queries


def merged_catalogue(queries: list[str], limit: int) -> list[dict[str, Any]]:
    """Run each query (in parallel) and merge results, first query wins order."""
    unique = list(dict.fromkeys(q for q in queries if q and q.strip()))
    if not unique:
        return []
    if len(unique) == 1:
        return search_catalogue(unique[0], limit)

    def run(query: str) -> list[dict[str, Any]]:
        return search_catalogue(query, limit)

    with ThreadPoolExecutor(max_workers=min(3, len(unique))) as pool:
        batches = list(pool.map(run, unique))

    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for batch in batches:
        for row in batch:
            row_id = str(row.get("id") or row.get("videoId") or "")
            if not row_id or row_id in seen:
                continue
            seen.add(row_id)
            merged.append(row)
            if len(merged) >= limit:
                return merged
    return merged
