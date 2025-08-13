# cache_feeding_methods.py
"""
Metodi per alimentare la cache del geocoding con nuovi indirizzi.
Questo file mostra tutti i modi per popolare e gestire la cache.
"""

from geocoding_cache import get_geocoding_cache
from datetime import datetime, timedelta
import time
import json


class CacheFeeder:
    """Classe per alimentare la cache in modo intelligente"""

    def __init__(self):
        self.cache = get_geocoding_cache()

    def feed_from_positions_history(self, hours_back=168):  # 7 giorni default
        """
        Alimenta la cache analizzando lo storico delle posizioni dei dispositivi

        Args:
            hours_back: Quante ore indietro analizzare (default: 7 giorni)
        """
        print(f"🔍 Analisi storico posizioni ({hours_back} ore)...")

        # Ottieni tutti i dispositivi
        from app import traccar_api
        devices = traccar_api.get_devices()

        if not devices:
            print("⚠️ Nessun dispositivo trovato")
            return

        total_positions = 0
        cache_additions = 0

        to_time = datetime.now()
        from_time = to_time - timedelta(hours=hours_back)

        for device in devices:
            print(f"📱 Processando dispositivo: {device.get('name', device.get('id'))}")

            # Ottieni posizioni per questo dispositivo
            positions = traccar_api.get_positions(device['id'], from_time, to_time)

            if not positions:
                continue

            total_positions += len(positions)

            # Raggruppa per precisione per evitare duplicati
            unique_coords = set()

            for pos in positions:
                lat = pos.get('latitude')
                lng = pos.get('longitude')

                if lat and lng:
                    # Arrotonda a 3 decimali per raggruppare posizioni vicine
                    coord_key = (round(lat, 3), round(lng, 3))
                    unique_coords.add(coord_key)

            print(f"   📍 {len(unique_coords)} coordinate unique da {len(positions)} posizioni")

            # Processa coordinate unique
            for lat, lng in unique_coords:
                try:
                    # Controlla se già in cache
                    cached = self.cache._get_cached_reverse(lat, lng, 3)

                    if not cached:
                        # Aggiungi alla cache con chiamata API
                        result = self.cache.reverse_geocode(lat, lng, 3)
                        if result and not result.get('error'):
                            cache_additions += 1
                            print(f"   ✅ Aggiunto: {lat}, {lng} -> {result.get('formatted_address', '')[:50]}...")

                        # Pausa per rispettare rate limit
                        time.sleep(1.1)  # Nominatim: max 1 req/sec

                except Exception as e:
                    print(f"   ❌ Errore per {lat}, {lng}: {e}")
                    continue

        print(f"\n🎉 Completato!")
        print(f"📊 Posizioni analizzate: {total_positions}")
        print(f"🆕 Nuovi indirizzi in cache: {cache_additions}")

        # Mostra statistiche finali
        stats = self.cache.get_cache_stats()
        print(f"📈 Cache totale: {stats['reverse_geocoding']['valid_entries']} voci")

    def feed_from_coordinate_list(self, coordinates, precision=3):
        """
        Alimenta la cache da una lista di coordinate

        Args:
            coordinates: Lista di tuple (lat, lng) o dict {'lat': x, 'lng': y}
            precision: Precisione cache (default: 3)
        """
        print(f"📋 Alimentazione da lista di {len(coordinates)} coordinate...")

        added = 0
        skipped = 0
        errors = 0

        for coord in coordinates:
            try:
                # Normalizza formato coordinate
                if isinstance(coord, dict):
                    lat, lng = coord['lat'], coord['lng']
                elif isinstance(coord, (list, tuple)):
                    lat, lng = coord[0], coord[1]
                else:
                    print(f"⚠️ Formato coordinate non valido: {coord}")
                    errors += 1
                    continue

                # Controlla se già in cache
                cached = self.cache._get_cached_reverse(lat, lng, precision)

                if cached:
                    skipped += 1
                    continue

                # Aggiungi alla cache
                result = self.cache.reverse_geocode(lat, lng, precision)
                if result and not result.get('error'):
                    added += 1
                    print(f"✅ {lat}, {lng} -> {result.get('formatted_address', '')[:50]}...")
                else:
                    errors += 1
                    print(f"❌ Errore per {lat}, {lng}")

                # Rate limiting
                time.sleep(1.1)

            except Exception as e:
                errors += 1
                print(f"❌ Errore elaborazione: {e}")

        print(f"\n📊 Risultati:")
        print(f"   ✅ Aggiunti: {added}")
        print(f"   ⏭️ Già in cache: {skipped}")
        print(f"   ❌ Errori: {errors}")

    def feed_from_csv_file(self, csv_path, lat_col='latitude', lng_col='longitude'):
        """
        Alimenta la cache da file CSV con coordinate

        Args:
            csv_path: Percorso file CSV
            lat_col: Nome colonna latitudine
            lng_col: Nome colonna longitudine
        """
        print(f"📂 Caricamento da CSV: {csv_path}")

        try:
            import pandas as pd

            # Leggi CSV
            df = pd.read_csv(csv_path)
            print(f"📄 Caricate {len(df)} righe dal CSV")

            # Verifica colonne
            if lat_col not in df.columns or lng_col not in df.columns:
                print(f"❌ Colonne non trovate. Disponibili: {list(df.columns)}")
                return

            # Rimuovi righe con coordinate mancanti
            df_clean = df.dropna(subset=[lat_col, lng_col])
            print(f"📍 {len(df_clean)} righe con coordinate valide")

            # Converti in lista coordinate
            coordinates = [(row[lat_col], row[lng_col]) for _, row in df_clean.iterrows()]

            # Alimenta cache
            self.feed_from_coordinate_list(coordinates)

        except ImportError:
            print("❌ pandas non installato. Usa: pip install pandas")
        except Exception as e:
            print(f"❌ Errore lettura CSV: {e}")

    def feed_from_geojson(self, geojson_path):
        """
        Alimenta la cache da file GeoJSON

        Args:
            geojson_path: Percorso file GeoJSON
        """
        print(f"🗺️ Caricamento da GeoJSON: {geojson_path}")

        try:
            with open(geojson_path, 'r') as f:
                geojson = json.load(f)

            coordinates = []

            # Estrai coordinate da features
            if 'features' in geojson:
                for feature in geojson['features']:
                    geometry = feature.get('geometry', {})
                    geom_type = geometry.get('type')
                    coords = geometry.get('coordinates', [])

                    if geom_type == 'Point':
                        # Punto singolo [lng, lat] -> [lat, lng]
                        coordinates.append((coords[1], coords[0]))
                    elif geom_type in ['LineString', 'MultiPoint']:
                        # Lista di punti
                        for coord in coords:
                            coordinates.append((coord[1], coord[0]))
                    elif geom_type == 'Polygon':
                        # Poligono: primo anello
                        for coord in coords[0]:
                            coordinates.append((coord[1], coord[0]))

            print(f"📍 Estratte {len(coordinates)} coordinate")

            # Rimuovi duplicati
            unique_coords = list(set(coordinates))
            print(f"🔹 {len(unique_coords)} coordinate uniche")

            # Alimenta cache
            self.feed_from_coordinate_list(unique_coords)

        except Exception as e:
            print(f"❌ Errore lettura GeoJSON: {e}")

    def feed_from_areas_of_interest(self, areas):
        """
        Pre-popola la cache per aree di interesse specifiche

        Args:
            areas: Lista di dict con 'name', 'lat', 'lng', 'radius_km'
        """
        print("🎯 Alimentazione aree di interesse...")

        for area in areas:
            name = area['name']
            center_lat = area['lat']
            center_lng = area['lng']
            radius_km = area['radius_km']

            print(f"📍 Area: {name} (raggio {radius_km}km)")

            # Genera griglia di punti nell'area
            points = self._generate_grid_points(center_lat, center_lng, radius_km)

            print(f"   🔸 Generati {len(points)} punti")

            # Alimenta cache per questi punti
            self.feed_from_coordinate_list(points)

    def _generate_grid_points(self, center_lat, center_lng, radius_km, grid_size_km=0.5):
        """
        Genera una griglia di punti in un'area circolare

        Args:
            center_lat: Latitudine centro
            center_lng: Longitudine centro
            radius_km: Raggio area in km
            grid_size_km: Spaziatura griglia in km
        """
        import math

        points = []

        # Converti km in gradi (approssimato)
        lat_deg_per_km = 1 / 111.32
        lng_deg_per_km = 1 / (111.32 * math.cos(math.radians(center_lat)))

        radius_lat = radius_km * lat_deg_per_km
        radius_lng = radius_km * lng_deg_per_km

        grid_lat = grid_size_km * lat_deg_per_km
        grid_lng = grid_size_km * lng_deg_per_km

        # Genera griglia
        lat = center_lat - radius_lat
        while lat <= center_lat + radius_lat:
            lng = center_lng - radius_lng
            while lng <= center_lng + radius_lng:
                # Verifica se il punto è dentro il cerchio
                distance = math.sqrt(
                    ((lat - center_lat) / lat_deg_per_km) ** 2 +
                    ((lng - center_lng) / lng_deg_per_km) ** 2
                )

                if distance <= radius_km:
                    points.append((lat, lng))

                lng += grid_lng
            lat += grid_lat

        return points

    def schedule_automatic_feeding(self, interval_hours=24):
        """
        Programma alimentazione automatica della cache

        Args:
            interval_hours: Intervallo in ore tra le alimentazioni
        """
        print(f"⏰ Programmazione alimentazione automatica ogni {interval_hours} ore")

        # Questa funzione dovrebbe essere integrata con un task scheduler
        # come Celery, cron, o APScheduler

        # Esempio con APScheduler:
        try:
            from apscheduler.schedulers.background import BackgroundScheduler

            scheduler = BackgroundScheduler()

            # Programma alimentazione storico
            scheduler.add_job(
                func=lambda: self.feed_from_positions_history(hours_back=interval_hours),
                trigger="interval",
                hours=interval_hours,
                id='cache_feeding'
            )

            scheduler.start()
            print("✅ Scheduler avviato")

        except ImportError:
            print("⚠️ APScheduler non installato. Usa: pip install apscheduler")
            print("💡 Alternativa: configura job cron per chiamare script di alimentazione")


# === FUNZIONI DI UTILITY ===

def bulk_feed_cache_from_traccar():
    """Alimenta la cache con tutto lo storico Traccar disponibile"""
    feeder = CacheFeeder()

    print("🚀 Alimentazione massiva cache da storico Traccar")
    print("⚠️ Questa operazione può richiedere molto tempo!")

    confirm = input("Continuare? (y/N): ")
    if confirm.lower() != 'y':
        print("❌ Operazione annullata")
        return

    # Alimenta con storico esteso (30 giorni)
    feeder.feed_from_positions_history(hours_back=24 * 30)


def feed_cache_for_city(city_name, radius_km=10):
    """Alimenta la cache per una città specifica"""
    feeder = CacheFeeder()

    print(f"🏙️ Alimentazione cache per: {city_name}")

    # Prima geocodifica la città per ottenere coordinate
    result = feeder.cache.geocode(city_name)

    if result and not result.get('error'):
        center_lat = result['lat']
        center_lng = result['lng']

        print(f"📍 Coordinate {city_name}: {center_lat}, {center_lng}")

        # Alimenta area intorno alla città
        areas = [{
            'name': city_name,
            'lat': center_lat,
            'lng': center_lng,
            'radius_km': radius_km
        }]

        feeder.feed_from_areas_of_interest(areas)

    else:
        print(f"❌ Impossibile geocodificare: {city_name}")


def feed_cache_from_coordinate_string():
    """Alimenta cache da input manuale coordinate"""
    feeder = CacheFeeder()

    print("📝 Inserimento manuale coordinate")
    print("Formato: lat,lng (uno per riga, 'fine' per terminare)")

    coordinates = []

    while True:
        coord_input = input("Coordinate (lat,lng): ").strip()

        if coord_input.lower() == 'fine':
            break

        try:
            lat, lng = map(float, coord_input.split(','))
            coordinates.append((lat, lng))
            print(f"✅ Aggiunta: {lat}, {lng}")
        except:
            print("❌ Formato non valido. Usa: lat,lng")

    if coordinates:
        feeder.feed_from_coordinate_list(coordinates)
    else:
        print("⚠️ Nessuna coordinata inserita")


# === SCRIPT PRINCIPALE ===

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Uso: python cache_feeding_methods.py <comando> [parametri]")
        print("\nComandi disponibili:")
        print("  history [ore]          - Alimenta da storico posizioni")
        print("  city <nome> [raggio]   - Alimenta per città specifica")
        print("  csv <file> [lat_col] [lng_col] - Alimenta da file CSV")
        print("  geojson <file>         - Alimenta da file GeoJSON")
        print("  manual                 - Inserimento manuale coordinate")
        print("  bulk                   - Alimentazione massiva (30 giorni)")
        sys.exit(1)

    command = sys.argv[1].lower()

    if command == "history":
        hours = int(sys.argv[2]) if len(sys.argv) > 2 else 168
        feeder = CacheFeeder()
        feeder.feed_from_positions_history(hours)

    elif command == "city":
        if len(sys.argv) < 3:
            print("❌ Nome città richiesto")
            sys.exit(1)
        city = sys.argv[2]
        radius = int(sys.argv[3]) if len(sys.argv) > 3 else 10
        feed_cache_for_city(city, radius)

    elif command == "csv":
        if len(sys.argv) < 3:
            print("❌ File CSV richiesto")
            sys.exit(1)
        csv_file = sys.argv[2]
        lat_col = sys.argv[3] if len(sys.argv) > 3 else 'latitude'
        lng_col = sys.argv[4] if len(sys.argv) > 4 else 'longitude'
        feeder = CacheFeeder()
        feeder.feed_from_csv_file(csv_file, lat_col, lng_col)

    elif command == "geojson":
        if len(sys.argv) < 3:
            print("❌ File GeoJSON richiesto")
            sys.exit(1)
        geojson_file = sys.argv[2]
        feeder = CacheFeeder()
        feeder.feed_from_geojson(geojson_file)

    elif command == "manual":
        feed_cache_from_coordinate_string()

    elif command == "bulk":
        bulk_feed_cache_from_traccar()

    else:
        print(f"❌ Comando sconosciuto: {command}")
        sys.exit(1)