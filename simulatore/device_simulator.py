#!/usr/bin/env python3
"""
Device Path Simulator for Traccar GPS System
Simula il percorso di un dispositivo GPS inviando posizioni al server Traccar.
"""

import time
import json
import requests
import threading
import random
import math
from datetime import datetime, timezone
from typing import List, Tuple, Dict, Optional
import logging
import argparse
import signal
import sys

# Configurazione logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('device_simulator.log'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)


class GPSSimulator:
    """Simulatore GPS per un dispositivo"""

    def __init__(self, device_config: Dict):
        """
        Inizializza il simulatore

        Args:
            device_config: Configurazione del dispositivo
        """
        self.device_id = device_config['device_id']
        self.device_imei = device_config['imei']
        self.traccar_server = device_config['traccar_server']
        self.update_interval = device_config.get('update_interval', 30)  # secondi
        self.speed_kmh = device_config.get('speed_kmh', 50)  # km/h

        # Percorso predefinito o generato
        self.path = device_config.get('path', [])
        self.current_position_index = 0
        self.is_running = False
        self.thread = None

        # Posizione corrente
        self.current_lat = 0.0
        self.current_lng = 0.0
        self.current_altitude = 100.0
        self.current_course = 0.0

        # Statistiche
        self.total_distance = 0.0
        self.start_time = None
        self.packets_sent = 0
        self.packets_failed = 0

    def generate_circular_path(self, center_lat: float, center_lng: float,
                               radius_km: float = 5.0, points: int = 20) -> List[Tuple[float, float]]:
        """
        Genera un percorso circolare

        Args:
            center_lat: Latitudine del centro
            center_lng: Longitudine del centro
            radius_km: Raggio in km
            points: Numero di punti del percorso

        Returns:
            Lista di coordinate (lat, lng)
        """
        path = []
        for i in range(points + 1):  # +1 per chiudere il cerchio
            angle = 2 * math.pi * i / points

            # Conversione km in gradi (approssimativa)
            lat_offset = radius_km / 111.32  # 1 grado lat ≈ 111.32 km
            lng_offset = radius_km / (111.32 * math.cos(math.radians(center_lat)))

            lat = center_lat + lat_offset * math.cos(angle)
            lng = center_lng + lng_offset * math.sin(angle)

            path.append((lat, lng))

        return path

    def generate_route_path(self, start: Tuple[float, float],
                            end: Tuple[float, float], points: int = 50) -> List[Tuple[float, float]]:
        """
        Genera un percorso lineare con variazioni casuali

        Args:
            start: Coordinate di partenza (lat, lng)
            end: Coordinate di arrivo (lat, lng)
            points: Numero di punti intermedi

        Returns:
            Lista di coordinate (lat, lng)
        """
        path = []
        start_lat, start_lng = start
        end_lat, end_lng = end

        for i in range(points + 1):
            progress = i / points

            # Interpolazione lineare
            lat = start_lat + (end_lat - start_lat) * progress
            lng = start_lng + (end_lng - start_lng) * progress

            # Aggiungi variazione casuale per simulare strade
            if i > 0 and i < points:
                variation = 0.001  # Circa 100 metri
                lat += random.uniform(-variation, variation)
                lng += random.uniform(-variation, variation)

            path.append((lat, lng))

        return path

    def calculate_distance(self, lat1: float, lng1: float,
                           lat2: float, lng2: float) -> float:
        """
        Calcola la distanza tra due punti in km usando la formula di Haversine
        """
        R = 6371  # Raggio della Terra in km

        lat1_rad = math.radians(lat1)
        lat2_rad = math.radians(lat2)
        delta_lat = math.radians(lat2 - lat1)
        delta_lng = math.radians(lng2 - lng1)

        a = (math.sin(delta_lat / 2) ** 2 +
             math.cos(lat1_rad) * math.cos(lat2_rad) *
             math.sin(delta_lng / 2) ** 2)
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

        return R * c

    def calculate_bearing(self, lat1: float, lng1: float,
                          lat2: float, lng2: float) -> float:
        """
        Calcola il bearing (direzione) tra due punti
        """
        lat1_rad = math.radians(lat1)
        lat2_rad = math.radians(lat2)
        delta_lng_rad = math.radians(lng2 - lng1)

        y = math.sin(delta_lng_rad) * math.cos(lat2_rad)
        x = (math.cos(lat1_rad) * math.sin(lat2_rad) -
             math.sin(lat1_rad) * math.cos(lat2_rad) * math.cos(delta_lng_rad))

        bearing = math.atan2(y, x)
        bearing = math.degrees(bearing)
        bearing = (bearing + 360) % 360

        return bearing

    def interpolate_position(self, start: Tuple[float, float],
                             end: Tuple[float, float], progress: float) -> Tuple[float, float]:
        """
        Interpola la posizione tra due punti
        """
        start_lat, start_lng = start
        end_lat, end_lng = end

        lat = start_lat + (end_lat - start_lat) * progress
        lng = start_lng + (end_lng - start_lng) * progress

        return lat, lng

    def send_position_to_traccar(self, lat: float, lng: float,
                                 altitude: float = 100.0, course: float = 0.0,
                                 speed: float = 0.0) -> bool:
        """
        Invia la posizione al server Traccar usando il protocollo Osmand

        Args:
            lat: Latitudine
            lng: Longitudine
            altitude: Altitudine in metri
            course: Direzione in gradi
            speed: Velocità in km/h

        Returns:
            True se inviato con successo, False altrimenti
        """
        try:
            # Timestamp UTC in formato Unix (secondi)
            timestamp = int(datetime.now(timezone.utc).timestamp())

            # Converte velocità da km/h a nodi (Traccar preferisce nodi)
            speed_knots = speed * 0.539957  # 1 km/h = 0.539957 nodi

            # Parametri per il protocollo Osmand
            params = {
                'id': self.device_imei,
                'lat': round(lat, 6),
                'lon': round(lng, 6),
                'altitude': int(altitude),
                'course': int(course),
                'speed': round(speed_knots, 2),  # Velocità in nodi
                'timestamp': timestamp,
                'hdop': 1.0,
                'sat': 8,
                'valid': 'true'
            }

            # URL per il protocollo Osmand (porta 5055 di default)
            # Rimuovi http:// se presente nel server URL
            server_base = self.traccar_server.replace('http://', '').replace('https://', '')
            url = f"http://{server_base}:5055"

            # Debug: mostra URL e parametri
            logger.debug(f"Sending to URL: {url}")
            logger.debug(f"Params: {params}")

            # Invia richiesta GET
            response = requests.get(url, params=params, timeout=10)

            if response.status_code == 200:
                self.packets_sent += 1
                logger.debug(f"Position sent: {lat:.6f}, {lng:.6f} - Response: {response.text}")
                return True
            else:
                self.packets_failed += 1
                logger.warning(f"Failed to send position. Status: {response.status_code}, Response: {response.text}")
                logger.warning(f"URL used: {url}")
                logger.warning(f"Params sent: {params}")
                return False

        except Exception as e:
            self.packets_failed += 1
            logger.error(f"Error sending position: {e}")
            return False

    def simulate_movement(self):
        """
        Simula il movimento del dispositivo lungo il percorso
        """
        if not self.path:
            logger.error("Nessun percorso definito per la simulazione")
            return

        self.start_time = datetime.now()
        logger.info(f"Iniziata simulazione per dispositivo {self.device_imei}")
        logger.info(
            f"Percorso: {len(self.path)} punti, Intervallo: {self.update_interval}s, Velocità: {self.speed_kmh} km/h")

        while self.is_running:
            try:
                # Calcola la posizione corrente
                if self.current_position_index >= len(self.path) - 1:
                    # Fine del percorso, ricomincia
                    self.current_position_index = 0
                    logger.info("Percorso completato, ricomincio dall'inizio")

                # Punti correnti
                current_point = self.path[self.current_position_index]
                next_point = self.path[self.current_position_index + 1]

                # Calcola distanza e tempo per raggiungere il prossimo punto
                distance_km = self.calculate_distance(
                    current_point[0], current_point[1],
                    next_point[0], next_point[1]
                )

                # Calcola quanti step servono per raggiungere il prossimo punto
                time_to_next = (distance_km / self.speed_kmh) * 3600  # secondi
                steps_needed = max(1, int(time_to_next / self.update_interval))

                # Interpola la posizione
                for step in range(steps_needed):
                    if not self.is_running:
                        break

                    progress = step / steps_needed
                    lat, lng = self.interpolate_position(current_point, next_point, progress)

                    # Calcola bearing e altre informazioni
                    course = self.calculate_bearing(
                        current_point[0], current_point[1],
                        next_point[0], next_point[1]
                    )

                    # Aggiungi un po' di rumore ai dati
                    lat += random.uniform(-0.00005, 0.00005)  # ~5 metri
                    lng += random.uniform(-0.00005, 0.00005)
                    altitude = self.current_altitude + random.uniform(-10, 10)
                    speed_with_noise = self.speed_kmh + random.uniform(-5, 5)
                    speed_with_noise = max(0, speed_with_noise)

                    # Invia posizione
                    success = self.send_position_to_traccar(
                        lat, lng, altitude, course, speed_with_noise
                    )

                    if success:
                        self.current_lat = lat
                        self.current_lng = lng
                        self.current_altitude = altitude
                        self.current_course = course
                        self.total_distance += distance_km / steps_needed

                        # Log periodico
                        if self.packets_sent % 10 == 0:
                            logger.info(f"Inviati {self.packets_sent} pacchetti - Pos: {lat:.6f}, {lng:.6f}")

                    # Aspetta prima del prossimo aggiornamento
                    time.sleep(self.update_interval)

                # Passa al prossimo punto del percorso
                self.current_position_index += 1

            except Exception as e:
                logger.error(f"Errore durante la simulazione: {e}")
                time.sleep(self.update_interval)

    def start_simulation(self):
        """Avvia la simulazione in un thread separato"""
        if self.is_running:
            logger.warning("Simulazione già in corso")
            return

        self.is_running = True
        self.thread = threading.Thread(target=self.simulate_movement)
        self.thread.daemon = True
        self.thread.start()
        logger.info(f"Simulazione avviata per dispositivo {self.device_imei}")

    def stop_simulation(self):
        """Ferma la simulazione"""
        if not self.is_running:
            return

        self.is_running = False
        if self.thread:
            self.thread.join(timeout=5)

        # Statistiche finali
        if self.start_time:
            duration = datetime.now() - self.start_time
            logger.info(f"Simulazione terminata per dispositivo {self.device_imei}")
            logger.info(f"Durata: {duration}")
            logger.info(f"Pacchetti inviati: {self.packets_sent}")
            logger.info(f"Pacchetti falliti: {self.packets_failed}")
            logger.info(f"Distanza percorsa: {self.total_distance:.2f} km")

    def get_status(self) -> Dict:
        """Restituisce lo stato corrente della simulazione"""
        duration = None
        if self.start_time:
            duration = str(datetime.now() - self.start_time)

        return {
            'device_id': self.device_id,
            'device_imei': self.device_imei,
            'is_running': self.is_running,
            'current_position': {
                'lat': self.current_lat,
                'lng': self.current_lng,
                'altitude': self.current_altitude,
                'course': self.current_course
            },
            'path_progress': f"{self.current_position_index}/{len(self.path)}",
            'packets_sent': self.packets_sent,
            'packets_failed': self.packets_failed,
            'total_distance_km': round(self.total_distance, 2),
            'duration': duration
        }


class SimulatorManager:
    """Gestore di multipli simulatori"""

    def __init__(self):
        self.simulators = {}
        self.running = True

    def add_simulator(self, simulator: GPSSimulator):
        """Aggiunge un simulatore"""
        self.simulators[simulator.device_imei] = simulator

    def start_all(self):
        """Avvia tutti i simulatori"""
        for simulator in self.simulators.values():
            simulator.start_simulation()

    def stop_all(self):
        """Ferma tutti i simulatori"""
        logger.info("Fermando tutti i simulatori...")
        for simulator in self.simulators.values():
            simulator.stop_simulation()
        self.running = False

    def get_status_all(self) -> Dict:
        """Restituisce lo stato di tutti i simulatori"""
        status = {}
        for imei, simulator in self.simulators.items():
            status[imei] = simulator.get_status()
        return status


def load_config(config_file: str) -> Dict:
    """Carica la configurazione da file JSON"""
    try:
        with open(config_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        logger.error(f"File di configurazione non trovato: {config_file}")
        return {}
    except json.JSONDecodeError as e:
        logger.error(f"Errore nel parsing del file di configurazione: {e}")
        return {}


def create_default_config():
    """Crea un file di configurazione di esempio"""
    config = {
        "traccar_server": "http://localhost:8082",
        "devices": [
            {
                "device_id": "001",
                "imei": "123456789012345",
                "update_interval": 30,
                "speed_kmh": 50,
                "simulation_type": "circular",
                "center_lat": 45.4642,
                "center_lng": 9.1900,
                "radius_km": 2.0
            },
            {
                "device_id": "002",
                "imei": "123456789012346",
                "update_interval": 20,
                "speed_kmh": 60,
                "simulation_type": "route",
                "start_lat": 45.4642,
                "start_lng": 9.1900,
                "end_lat": 45.4842,
                "end_lng": 9.2100
            }
        ]
    }

    with open('simulator_config.json', 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)

    logger.info("File di configurazione di esempio creato: simulator_config.json")


def signal_handler(signum, frame):
    """Gestore per i segnali di sistema"""
    logger.info("Ricevuto segnale di terminazione...")
    global manager
    if manager:
        manager.stop_all()
    sys.exit(0)


def main():
    """Funzione principale"""
    parser = argparse.ArgumentParser(description='Simulatore GPS per Traccar')
    parser.add_argument('--config', '-c', default='simulator_config.json',
                        help='File di configurazione JSON')
    parser.add_argument('--create-config', action='store_true',
                        help='Crea un file di configurazione di esempio')
    parser.add_argument('--verbose', '-v', action='store_true',
                        help='Output verboso')

    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    if args.create_config:
        create_default_config()
        return

    # Gestione segnali
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Carica configurazione
    config = load_config(args.config)
    if not config:
        logger.error("Impossibile caricare la configurazione. Usa --create-config per crearne una di esempio.")
        return

    # Crea manager
    global manager
    manager = SimulatorManager()

    # Crea simulatori
    traccar_server = config.get('traccar_server', 'http://localhost:8082')

    for device_config in config.get('devices', []):
        device_config['traccar_server'] = traccar_server

        simulator = GPSSimulator(device_config)

        # Genera percorso basato sul tipo
        sim_type = device_config.get('simulation_type', 'circular')

        if sim_type == 'circular':
            center_lat = device_config.get('center_lat', 45.4642)
            center_lng = device_config.get('center_lng', 9.1900)
            radius_km = device_config.get('radius_km', 2.0)
            points = device_config.get('points', 20)

            path = simulator.generate_circular_path(center_lat, center_lng, radius_km, points)
            simulator.path = path

        elif sim_type == 'route':
            start_lat = device_config.get('start_lat', 45.4642)
            start_lng = device_config.get('start_lng', 9.1900)
            end_lat = device_config.get('end_lat', 45.4842)
            end_lng = device_config.get('end_lng', 9.2100)
            points = device_config.get('points', 50)

            path = simulator.generate_route_path((start_lat, start_lng), (end_lat, end_lng), points)
            simulator.path = path

        elif sim_type == 'custom':
            # Percorso personalizzato definito nella configurazione
            simulator.path = device_config.get('path', [])

        if simulator.path:
            manager.add_simulator(simulator)
            logger.info(f"Aggiunto simulatore per dispositivo {device_config['imei']}")
        else:
            logger.error(f"Nessun percorso definito per il dispositivo {device_config['imei']}")

    if not manager.simulators:
        logger.error("Nessun simulatore configurato correttamente")
        return

    # Avvia tutti i simulatori
    logger.info(f"Avvio di {len(manager.simulators)} simulatori...")
    manager.start_all()

    # Monitor loop
    try:
        while manager.running:
            time.sleep(60)  # Status ogni minuto

            total_sent = sum(sim.packets_sent for sim in manager.simulators.values())
            total_failed = sum(sim.packets_failed for sim in manager.simulators.values())
            active_sims = sum(1 for sim in manager.simulators.values() if sim.is_running)

            logger.info(
                f"Status: {active_sims} simulatori attivi, {total_sent} pacchetti inviati, {total_failed} falliti")

    except KeyboardInterrupt:
        pass

    # Cleanup
    manager.stop_all()
    logger.info("Simulazione terminata")


if __name__ == "__main__":
    main()