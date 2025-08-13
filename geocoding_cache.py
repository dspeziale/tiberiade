# geocoding_cache.py
import sqlite3
import os
import time
import requests
import hashlib
from typing import Optional, Dict, Any, Tuple
from datetime import datetime, timedelta
import logging
import json


class GeocodingCache:
    """
    Sistema di cache per il geocoding con SQLite.
    Supporta geocoding normale e reverse geocoding con TTL configurabile.
    """

    def __init__(self, db_path: str = "geocoding_cache.db", default_ttl: int = 7 * 24 * 3600):
        """
        Inizializza il sistema di cache

        Args:
            db_path: Percorso del database SQLite
            default_ttl: TTL predefinito in secondi (default: 7 giorni)
        """
        self.db_path = db_path
        self.default_ttl = default_ttl
        self.logger = logging.getLogger(__name__)

        # Configurazione servizi di geocoding
        self.geocoding_services = {
            'nominatim': {
                'base_url': 'https://nominatim.openstreetmap.org',
                'rate_limit': 1.0,  # 1 request per second
                'headers': {'User-Agent': 'TraccarDashboard/1.0'}
            },
            'opencage': {
                'base_url': 'https://api.opencagedata.com/geocode/v1',
                'api_key': None,  # Da configurare
                'rate_limit': 10.0  # requests per second con API key
            }
        }

        self._init_database()

    def _init_database(self):
        """Inizializza il database SQLite con le tabelle necessarie"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()

            # Tabella per il reverse geocoding (coordinate -> indirizzo)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS reverse_geocoding_cache (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    lat REAL NOT NULL,
                    lng REAL NOT NULL,
                    precision_level INTEGER NOT NULL,
                    address TEXT NOT NULL,
                    formatted_address TEXT NOT NULL,
                    country TEXT,
                    state TEXT,
                    city TEXT,
                    postal_code TEXT,
                    street TEXT,
                    house_number TEXT,
                    service_used TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP NOT NULL,
                    access_count INTEGER DEFAULT 1,
                    last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # Tabella per il geocoding normale (indirizzo -> coordinate)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS geocoding_cache (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    address_hash TEXT NOT NULL UNIQUE,
                    original_address TEXT NOT NULL,
                    lat REAL NOT NULL,
                    lng REAL NOT NULL,
                    formatted_address TEXT NOT NULL,
                    confidence REAL,
                    country TEXT,
                    state TEXT,
                    city TEXT,
                    postal_code TEXT,
                    service_used TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP NOT NULL,
                    access_count INTEGER DEFAULT 1,
                    last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            # Indici per migliorare le performance
            cursor.execute(
                'CREATE INDEX IF NOT EXISTS idx_reverse_coords ON reverse_geocoding_cache (lat, lng, precision_level)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_reverse_expires ON reverse_geocoding_cache (expires_at)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_geocoding_hash ON geocoding_cache (address_hash)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_geocoding_expires ON geocoding_cache (expires_at)')

            conn.commit()

    def _coordinate_hash(self, lat: float, lng: float, precision: int = 4) -> str:
        """
        Crea un hash delle coordinate con precisione configurabile

        Args:
            lat: Latitudine
            lng: Longitudine
            precision: Numero di decimali di precisione (default: 4 = ~11m)
        """
        lat_rounded = round(lat, precision)
        lng_rounded = round(lng, precision)
        return f"{lat_rounded},{lng_rounded}"

    def _address_hash(self, address: str) -> str:
        """Crea un hash dell'indirizzo normalizzato"""
        normalized = address.lower().strip()
        return hashlib.md5(normalized.encode('utf-8')).hexdigest()

    def _cleanup_expired(self):
        """Rimuove le voci scadute dalla cache"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                now = datetime.now()

                # Cleanup reverse geocoding
                cursor.execute('DELETE FROM reverse_geocoding_cache WHERE expires_at < ?', (now,))
                reverse_deleted = cursor.rowcount

                # Cleanup geocoding normale
                cursor.execute('DELETE FROM geocoding_cache WHERE expires_at < ?', (now,))
                geocoding_deleted = cursor.rowcount

                conn.commit()

                if reverse_deleted > 0 or geocoding_deleted > 0:
                    self.logger.info(
                        f"Cache cleanup: {reverse_deleted} reverse, {geocoding_deleted} geocoding entries removed")

        except Exception as e:
            self.logger.error(f"Error during cache cleanup: {e}")

    def reverse_geocode(self, lat: float, lng: float, precision: int = 4,
                        ttl: Optional[int] = None, force_refresh: bool = False) -> Optional[Dict[str, Any]]:
        """
        Ottiene l'indirizzo dalle coordinate con cache

        Args:
            lat: Latitudine
            lng: Longitudine
            precision: Precisione per la cache (decimali)
            ttl: Time-to-live personalizzato in secondi
            force_refresh: Se True, ignora la cache e fa una nuova richiesta

        Returns:
            Dizionario con i dati dell'indirizzo o None se errore
        """
        if ttl is None:
            ttl = self.default_ttl

        coord_hash = self._coordinate_hash(lat, lng, precision)

        # Cleanup cache scaduta
        self._cleanup_expired()

        # Cerca nella cache se non è richiesto refresh forzato
        if not force_refresh:
            cached_result = self._get_cached_reverse(lat, lng, precision)
            if cached_result:
                self.logger.debug(f"Cache HIT per coordinate {lat},{lng}")
                return cached_result

        self.logger.debug(f"Cache MISS per coordinate {lat},{lng} - effettuo richiesta API")

        # Richiesta API
        api_result = self._api_reverse_geocode(lat, lng)
        if not api_result:
            return None

        # Salva nella cache
        self._save_reverse_cache(lat, lng, precision, api_result, ttl)

        return api_result

    def geocode(self, address: str, ttl: Optional[int] = None,
                force_refresh: bool = False) -> Optional[Dict[str, Any]]:
        """
        Ottiene le coordinate dall'indirizzo con cache

        Args:
            address: Indirizzo da geocodificare
            ttl: Time-to-live personalizzato in secondi
            force_refresh: Se True, ignora la cache e fa una nuova richiesta

        Returns:
            Dizionario con coordinate e dettagli o None se errore
        """
        if ttl is None:
            ttl = self.default_ttl

        address_hash = self._address_hash(address)

        # Cleanup cache scaduta
        self._cleanup_expired()

        # Cerca nella cache se non è richiesto refresh forzato
        if not force_refresh:
            cached_result = self._get_cached_geocoding(address_hash)
            if cached_result:
                self.logger.debug(f"Cache HIT per indirizzo: {address}")
                return cached_result

        self.logger.debug(f"Cache MISS per indirizzo: {address} - effettuo richiesta API")

        # Richiesta API
        api_result = self._api_geocode(address)
        if not api_result:
            return None

        # Salva nella cache
        self._save_geocoding_cache(address_hash, address, api_result, ttl)

        return api_result

    def _get_cached_reverse(self, lat: float, lng: float, precision: int) -> Optional[Dict[str, Any]]:
        """Cerca il reverse geocoding nella cache"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()

                lat_rounded = round(lat, precision)
                lng_rounded = round(lng, precision)

                cursor.execute('''
                    SELECT address, formatted_address, country, state, city, 
                           postal_code, street, house_number, service_used
                    FROM reverse_geocoding_cache 
                    WHERE lat = ? AND lng = ? AND precision_level = ? 
                    AND expires_at > ?
                    ORDER BY created_at DESC LIMIT 1
                ''', (lat_rounded, lng_rounded, precision, datetime.now()))

                result = cursor.fetchone()
                if result:
                    # Aggiorna statistiche di accesso
                    cursor.execute('''
                        UPDATE reverse_geocoding_cache 
                        SET access_count = access_count + 1, last_accessed = ?
                        WHERE lat = ? AND lng = ? AND precision_level = ?
                    ''', (datetime.now(), lat_rounded, lng_rounded, precision))

                    return {
                        'lat': lat,
                        'lng': lng,
                        'address': result[0],
                        'formatted_address': result[1],
                        'country': result[2],
                        'state': result[3],
                        'city': result[4],
                        'postal_code': result[5],
                        'street': result[6],
                        'house_number': result[7],
                        'service_used': result[8],
                        'cached': True
                    }

        except Exception as e:
            self.logger.error(f"Error reading reverse cache: {e}")

        return None

    def _get_cached_geocoding(self, address_hash: str) -> Optional[Dict[str, Any]]:
        """Cerca il geocoding nella cache"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()

                cursor.execute('''
                    SELECT lat, lng, formatted_address, confidence, country, 
                           state, city, postal_code, service_used, original_address
                    FROM geocoding_cache 
                    WHERE address_hash = ? AND expires_at > ?
                    ORDER BY created_at DESC LIMIT 1
                ''', (address_hash, datetime.now()))

                result = cursor.fetchone()
                if result:
                    # Aggiorna statistiche di accesso
                    cursor.execute('''
                        UPDATE geocoding_cache 
                        SET access_count = access_count + 1, last_accessed = ?
                        WHERE address_hash = ?
                    ''', (datetime.now(), address_hash))

                    return {
                        'lat': result[0],
                        'lng': result[1],
                        'formatted_address': result[2],
                        'confidence': result[3],
                        'country': result[4],
                        'state': result[5],
                        'city': result[6],
                        'postal_code': result[7],
                        'service_used': result[8],
                        'original_address': result[9],
                        'cached': True
                    }

        except Exception as e:
            self.logger.error(f"Error reading geocoding cache: {e}")

        return None

    def _save_reverse_cache(self, lat: float, lng: float, precision: int,
                            data: Dict[str, Any], ttl: int):
        """Salva il risultato del reverse geocoding nella cache"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()

                lat_rounded = round(lat, precision)
                lng_rounded = round(lng, precision)
                expires_at = datetime.now() + timedelta(seconds=ttl)

                cursor.execute('''
                    INSERT OR REPLACE INTO reverse_geocoding_cache 
                    (lat, lng, precision_level, address, formatted_address, 
                     country, state, city, postal_code, street, house_number, 
                     service_used, expires_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    lat_rounded, lng_rounded, precision,
                    json.dumps(data.get('address', {})),
                    data.get('formatted_address', ''),
                    data.get('country', ''),
                    data.get('state', ''),
                    data.get('city', ''),
                    data.get('postal_code', ''),
                    data.get('street', ''),
                    data.get('house_number', ''),
                    data.get('service_used', 'nominatim'),
                    expires_at
                ))

                conn.commit()

        except Exception as e:
            self.logger.error(f"Error saving reverse cache: {e}")

    def _save_geocoding_cache(self, address_hash: str, original_address: str,
                              data: Dict[str, Any], ttl: int):
        """Salva il risultato del geocoding nella cache"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()

                expires_at = datetime.now() + timedelta(seconds=ttl)

                cursor.execute('''
                    INSERT OR REPLACE INTO geocoding_cache 
                    (address_hash, original_address, lat, lng, formatted_address, 
                     confidence, country, state, city, postal_code, service_used, expires_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    address_hash, original_address,
                    data.get('lat'), data.get('lng'),
                    data.get('formatted_address', ''),
                    data.get('confidence'),
                    data.get('country', ''),
                    data.get('state', ''),
                    data.get('city', ''),
                    data.get('postal_code', ''),
                    data.get('service_used', 'nominatim'),
                    expires_at
                ))

                conn.commit()

        except Exception as e:
            self.logger.error(f"Error saving geocoding cache: {e}")

    def _api_reverse_geocode(self, lat: float, lng: float) -> Optional[Dict[str, Any]]:
        """Effettua la richiesta API per reverse geocoding"""
        try:
            # Usa Nominatim (OpenStreetMap) come servizio predefinito
            service = self.geocoding_services['nominatim']

            url = f"{service['base_url']}/reverse"
            params = {
                'lat': lat,
                'lon': lng,
                'format': 'json',
                'addressdetails': 1,
                'zoom': 18
            }

            response = requests.get(url, params=params, headers=service['headers'], timeout=10)

            if response.status_code == 200:
                data = response.json()

                # Normalizza la risposta
                result = {
                    'lat': lat,
                    'lng': lng,
                    'formatted_address': data.get('display_name', ''),
                    'service_used': 'nominatim',
                    'cached': False
                }

                # Estrai dettagli dell'indirizzo
                if 'address' in data:
                    addr = data['address']
                    result.update({
                        'address': addr,
                        'country': addr.get('country', ''),
                        'state': addr.get('state', ''),
                        'city': addr.get('city', addr.get('town', addr.get('village', ''))),
                        'postal_code': addr.get('postcode', ''),
                        'street': addr.get('road', ''),
                        'house_number': addr.get('house_number', '')
                    })

                # Rispetta il rate limit
                time.sleep(1.0 / service['rate_limit'])

                return result

            else:
                self.logger.warning(f"Reverse geocoding API error: {response.status_code}")

        except Exception as e:
            self.logger.error(f"Error in reverse geocoding API: {e}")

        return None

    def _api_geocode(self, address: str) -> Optional[Dict[str, Any]]:
        """Effettua la richiesta API per geocoding normale"""
        try:
            # Usa Nominatim (OpenStreetMap) come servizio predefinito
            service = self.geocoding_services['nominatim']

            url = f"{service['base_url']}/search"
            params = {
                'q': address,
                'format': 'json',
                'addressdetails': 1,
                'limit': 1
            }

            response = requests.get(url, params=params, headers=service['headers'], timeout=10)

            if response.status_code == 200:
                data = response.json()

                if data and len(data) > 0:
                    result_data = data[0]

                    # Normalizza la risposta
                    result = {
                        'lat': float(result_data.get('lat', 0)),
                        'lng': float(result_data.get('lon', 0)),
                        'formatted_address': result_data.get('display_name', ''),
                        'confidence': float(result_data.get('importance', 0)),
                        'service_used': 'nominatim',
                        'original_address': address,
                        'cached': False
                    }

                    # Estrai dettagli dell'indirizzo
                    if 'address' in result_data:
                        addr = result_data['address']
                        result.update({
                            'country': addr.get('country', ''),
                            'state': addr.get('state', ''),
                            'city': addr.get('city', addr.get('town', addr.get('village', ''))),
                            'postal_code': addr.get('postcode', '')
                        })

                    # Rispetta il rate limit
                    time.sleep(1.0 / service['rate_limit'])

                    return result

            else:
                self.logger.warning(f"Geocoding API error: {response.status_code}")

        except Exception as e:
            self.logger.error(f"Error in geocoding API: {e}")

        return None

    def get_cache_stats(self) -> Dict[str, Any]:
        """Restituisce statistiche sulla cache"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()

                # Statistiche reverse geocoding
                cursor.execute('SELECT COUNT(*) FROM reverse_geocoding_cache')
                reverse_total = cursor.fetchone()[0]

                cursor.execute('SELECT COUNT(*) FROM reverse_geocoding_cache WHERE expires_at > ?', (datetime.now(),))
                reverse_valid = cursor.fetchone()[0]

                cursor.execute('SELECT SUM(access_count) FROM reverse_geocoding_cache')
                reverse_hits = cursor.fetchone()[0] or 0

                # Statistiche geocoding normale
                cursor.execute('SELECT COUNT(*) FROM geocoding_cache')
                geocoding_total = cursor.fetchone()[0]

                cursor.execute('SELECT COUNT(*) FROM geocoding_cache WHERE expires_at > ?', (datetime.now(),))
                geocoding_valid = cursor.fetchone()[0]

                cursor.execute('SELECT SUM(access_count) FROM geocoding_cache')
                geocoding_hits = cursor.fetchone()[0] or 0

                return {
                    'database_path': self.db_path,
                    'database_size_mb': round(os.path.getsize(self.db_path) / 1024 / 1024, 2) if os.path.exists(
                        self.db_path) else 0,
                    'reverse_geocoding': {
                        'total_entries': reverse_total,
                        'valid_entries': reverse_valid,
                        'expired_entries': reverse_total - reverse_valid,
                        'total_hits': reverse_hits
                    },
                    'geocoding': {
                        'total_entries': geocoding_total,
                        'valid_entries': geocoding_valid,
                        'expired_entries': geocoding_total - geocoding_valid,
                        'total_hits': geocoding_hits
                    },
                    'default_ttl_hours': self.default_ttl / 3600
                }

        except Exception as e:
            self.logger.error(f"Error getting cache stats: {e}")
            return {'error': str(e)}

    def clear_cache(self, expired_only: bool = False) -> Dict[str, int]:
        """
        Pulisce la cache

        Args:
            expired_only: Se True, rimuove solo le voci scadute

        Returns:
            Dizionario con il numero di voci rimosse
        """
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()

                if expired_only:
                    # Rimuovi solo voci scadute
                    cursor.execute('DELETE FROM reverse_geocoding_cache WHERE expires_at < ?', (datetime.now(),))
                    reverse_deleted = cursor.rowcount

                    cursor.execute('DELETE FROM geocoding_cache WHERE expires_at < ?', (datetime.now(),))
                    geocoding_deleted = cursor.rowcount
                else:
                    # Rimuovi tutto
                    cursor.execute('DELETE FROM reverse_geocoding_cache')
                    reverse_deleted = cursor.rowcount

                    cursor.execute('DELETE FROM geocoding_cache')
                    geocoding_deleted = cursor.rowcount

                conn.commit()

                return {
                    'reverse_geocoding_deleted': reverse_deleted,
                    'geocoding_deleted': geocoding_deleted,
                    'total_deleted': reverse_deleted + geocoding_deleted
                }

        except Exception as e:
            self.logger.error(f"Error clearing cache: {e}")
            return {'error': str(e)}


# Istanza globale per l'utilizzo nell'app Flask
_geocoding_cache = None


def get_geocoding_cache() -> GeocodingCache:
    """Restituisce l'istanza globale della cache (singleton pattern)"""
    global _geocoding_cache
    if _geocoding_cache is None:
        _geocoding_cache = GeocodingCache()
    return _geocoding_cache