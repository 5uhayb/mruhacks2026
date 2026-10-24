"""Download country, solar/wind, and oil price data into backend/data/. Run: python fetch_data.py"""

from pathlib import Path

import pandas as pd
import requests

DATA = Path(__file__).parent / "data"
DATA.mkdir(exist_ok=True)

# Resource-rich countries that struggle to turn resources into development, plus success stories
COUNTRIES = {
    "LBY": ("Libya", "struggling"),
    "NGA": ("Nigeria", "struggling"),
    "VEN": ("Venezuela", "struggling"),
    "IRQ": ("Iraq", "struggling"),
    "AGO": ("Angola", "struggling"),
    "DZA": ("Algeria", "struggling"),
    "SSD": ("South Sudan", "struggling"),
    "YEM": ("Yemen", "struggling"),
    "NOR": ("Norway", "success"),
    "ARE": ("United Arab Emirates", "success"),
    "BWA": ("Botswana", "success"),
}

INDICATORS = {
    "NY.GDP.MKTP.CD": "gdp_usd",
    "NY.GDP.PCAP.CD": "gdp_per_capita_usd",
    "NY.GDP.MKTP.KD.ZG": "gdp_growth_pct",
    "NY.GDP.PETR.RT.ZS": "oil_rents_pct_gdp",
    "NY.GDP.TOTL.RT.ZS": "resource_rents_pct_gdp",
    "NE.GDI.TOTL.ZS": "investment_pct_gdp",
    "FP.CPI.TOTL.ZG": "inflation_pct",
    "SP.POP.TOTL": "population",
    "SP.URB.TOTL.IN.ZS": "urban_pct",
    "SL.UEM.TOTL.ZS": "unemployment_pct",
    "SL.UEM.1524.ZS": "youth_unemployment_pct",
    "EG.ELC.ACCS.ZS": "electricity_access_pct",
    "EG.FEC.RNEW.ZS": "renewable_energy_pct",
    "EG.USE.ELEC.KH.PC": "kwh_per_person",
    "SE.XPD.TOTL.GD.ZS": "education_spend_pct_gdp",
    "SP.DYN.LE00.IN": "life_expectancy",
    "IS.RRS.TOTL.KM": "rail_km",
    "GOV_WGI_CC.EST": "control_of_corruption",  # -2.5 (worst) to +2.5 (best)
    "GOV_WGI_GE.EST": "government_effectiveness",  # -2.5 (worst) to +2.5 (best)
}

# Candidate solar/wind sites: (country, site, lat, lon)
SITES = [
    ("LBY", "Tripoli", 32.89, 13.19),
    ("LBY", "Benghazi", 32.12, 20.09),
    ("LBY", "Misrata", 32.38, 15.09),
    ("LBY", "Sirte", 31.21, 16.59),
    ("LBY", "Tobruk", 32.08, 23.96),
    ("LBY", "Sabha", 27.04, 14.43),
    ("LBY", "Kufra", 24.18, 23.31),
    ("LBY", "Ghadames", 30.13, 9.50),
    ("LBY", "Ghat", 24.96, 10.18),
    ("LBY", "Jalu", 29.03, 21.55),
    ("LBY", "Hun", 29.12, 15.95),
    ("LBY", "Ajdabiya", 30.76, 20.23),
    ("NGA", "Kano", 12.00, 8.52),
    ("NGA", "Sokoto", 13.06, 5.24),
    ("NGA", "Lagos", 6.52, 3.38),
    ("NGA", "Maiduguri", 11.83, 13.15),
    ("VEN", "Maracaibo", 10.64, -71.61),
    ("VEN", "Caracas", 10.48, -66.90),
    ("VEN", "Paraguana", 11.95, -70.00),
    ("IRQ", "Baghdad", 33.31, 44.36),
    ("IRQ", "Basra", 30.51, 47.78),
    ("IRQ", "Rutba", 33.04, 40.28),
    ("AGO", "Luanda", -8.84, 13.23),
    ("AGO", "Namibe", -15.20, 12.15),
    ("AGO", "Huambo", -12.78, 15.74),
    ("DZA", "Algiers", 36.75, 3.06),
    ("DZA", "Tamanrasset", 22.79, 5.52),
    ("DZA", "Adrar", 27.87, -0.29),
    ("SSD", "Juba", 4.85, 31.58),
    ("SSD", "Malakal", 9.53, 31.66),
    ("YEM", "Sanaa", 15.37, 44.19),
    ("YEM", "Aden", 12.79, 45.03),
    ("NOR", "Oslo", 59.91, 10.75),
    ("ARE", "Abu Dhabi", 24.45, 54.38),
    ("BWA", "Gaborone", -24.65, 25.91),
]


def fetch_world_bank() -> pd.DataFrame:
    codes = ";".join(COUNTRIES)
    rows = []
    for code, name in INDICATORS.items():
        url = f"https://api.worldbank.org/v2/country/{codes}/indicator/{code}"
        res = requests.get(url, params={"format": "json", "per_page": 20000, "date": "1990:2026"}, timeout=60)
        payload = res.json()
        if len(payload) < 2 or payload[1] is None:
            print(f"  no data: {name}")
            continue
        for r in payload[1]:
            if r["value"] is not None:
                rows.append({"iso3": r["countryiso3code"], "year": int(r["date"]), "indicator": name, "value": r["value"]})
        print(f"  {name}: {sum(1 for r in payload[1] if r['value'] is not None)} values")
    long = pd.DataFrame(rows)
    wide = long.pivot_table(index=["iso3", "year"], columns="indicator", values="value").reset_index()
    wide.insert(1, "country", wide["iso3"].map(lambda c: COUNTRIES[c][0]))
    wide.insert(2, "group", wide["iso3"].map(lambda c: COUNTRIES[c][1]))
    # Oil revenue in dollars, derived from GDP x oil rents share
    wide["oil_rents_usd"] = wide["gdp_usd"] * wide["oil_rents_pct_gdp"] / 100
    return wide.sort_values(["iso3", "year"])


def fetch_sites() -> pd.DataFrame:
    rows = []
    for iso3, site, lat, lon in SITES:
        res = requests.get(
            "https://power.larc.nasa.gov/api/temporal/climatology/point",
            params={"parameters": "ALLSKY_SFC_SW_DWN,WS50M,T2M", "community": "RE", "latitude": lat, "longitude": lon, "format": "JSON"},
            timeout=60,
        )
        p = res.json()["properties"]["parameter"]
        rows.append({
            "iso3": iso3,
            "country": COUNTRIES[iso3][0],
            "site": site,
            "lat": lat,
            "lon": lon,
            "solar_kwh_m2_day": p["ALLSKY_SFC_SW_DWN"]["ANN"],  # sunlight hitting the ground
            "wind_50m_ms": p["WS50M"]["ANN"],  # wind speed at turbine height
            "temp_c": p["T2M"]["ANN"],
        })
        print(f"  {site}: solar {rows[-1]['solar_kwh_m2_day']}, wind {rows[-1]['wind_50m_ms']}")
    return pd.DataFrame(rows)


def fetch_oil_prices() -> pd.DataFrame:
    df = pd.read_csv("https://fred.stlouisfed.org/graph/fredgraph.csv?id=MCOILBRENTEU")
    df.columns = ["date", "brent_usd"]
    df["brent_usd"] = pd.to_numeric(df["brent_usd"], errors="coerce")
    return df.dropna()


if __name__ == "__main__":
    print("World Bank indicators...")
    fetch_world_bank().to_csv(DATA / "countries.csv", index=False)
    print("NASA POWER solar/wind sites...")
    fetch_sites().to_csv(DATA / "sites.csv", index=False)
    print("Brent oil prices (FRED)...")
    fetch_oil_prices().to_csv(DATA / "oil_prices.csv", index=False)
    print(f"Saved to {DATA}")
