#!/usr/bin/env python3
"""
Google Maps Route Generator for Traccar GPS Simulator
Genera percorsi reali utilizzando Google Maps Directions API
"""

import requests
import json
import polyline
from typing import List, Tuple, Dict, Optional
import logging
from datetime import datetime

logger = logging.getLogger(__name__)


class GoogleMapsRouteGenerator:
    """Generatore di percorsi utilizzando Google Maps Directions API"""

    def __init__(self, api_key: str):
        """
        Inizializza il generatore con la chiave API di Google Maps

        Args:
            api_key: Chiave API di Google Maps
        """
        self.api_key = api_key
        self.base_url = "https://maps.googleapis.com/maps/api/directions/json"

    def get_route_from_addresses(self,
                                 origin: str,
                                 destination: str,
                                 waypoints: Optional[List[str]] = None,
                                 travel_mode: str = "driving",
                                 avoid: Optional[List[str]] = None,
                                 optimize_waypoints: bool = False) -> Dict:
        """
        Ottiene un percorso da Google Maps utilizzando indirizzi

        Args:
            origin: Indirizzo di partenza
            destination: Indirizzo di destinazione
            waypoints: Lista di punti intermedi (opzionale)
            travel_mode: Modalità di viaggio (driving, walking, bicycling, transit)
            avoid: Lista di elementi da evitare (tolls, highways, ferries)
            optimize_waypoints: Ottimizza l'ordine dei waypoints

        Returns:
            Dizionario con informazioni sul percorso
        """
        params = {
            'origin': origin,
            'destination': destination,
            'key': self.api_key,
            'mode': travel_mode,
            'language': 'it',
            'region': 'it'
        }

        if waypoints:
            waypoints_str = '|'.join(waypoints)
            if optimize_waypoints:
                waypoints_str = 'optimize:true|' + waypoints_str
            params['waypoints'] = waypoints_str

        if avoid:
            params['avoid'] = '|'.join(avoid)

        try:
            response = requests.get(self.base_url, params=params)
            response.raise_for_status()
            return response.json()

        except requests.RequestException as e:
            logger.error(f"Errore nella richiesta a Google Maps: {e}")
            raise

    def get_route_from_coordinates(self,
                                   origin_lat: float,
                                   origin_lng: float,
                                   destination_lat: float,
                                   destination_lng: float,
                                   waypoints: Optional[List[Tuple[float, float]]] = None,
                                   travel_mode: str = "driving",
                                   avoid: Optional[List[str]] = None) -> Dict:
        """
        Ottiene un percorso da Google Maps utilizzando coordinate

        Args:
            origin_lat: Latitudine di partenza
            origin_lng: Longitudine di partenza
            destination_lat: Latitudine di destinazione
            destination_lng: Longitudine di destinazione
            waypoints: Lista di coordinate intermedie (lat, lng)
            travel_mode: Modalità di viaggio
            avoid: Lista di elementi da evitare

        Returns:
            Dizionario con informazioni sul percorso
        """
        origin = f"{origin_lat},{origin_lng}"
        destination = f"{destination_lat},{destination_lng}"

        waypoints_str = None
        if waypoints:
            waypoints_str = [f"{lat},{lng}" for lat, lng in waypoints]

        return self.get_route_from_addresses(
            origin=origin,
            destination=destination,
            waypoints=waypoints_str,
            travel_mode=travel_mode,
            avoid=avoid
        )

    def decode_polyline_to_coordinates(self, encoded_polyline: str,
                                       points_density: int = 50) -> List[Tuple[float, float]]:
        """
        Decodifica una polyline e la converte in coordinate per il simulatore

        Args:
            encoded_polyline: Polyline codificata da Google Maps
            points_density: Numero approssimativo di punti desiderati nel percorso

        Returns:
            Lista di coordinate (lat, lng)
        """
        # Decodifica la polyline
        coordinates = polyline.decode(encoded_polyline)

        # Se abbiamo troppi punti, riduciamo la densità
        if len(coordinates) > points_density:
            step = len(coordinates) // points_density
            coordinates = coordinates[::step]

        # Assicuriamoci di includere sempre l'ultimo punto
        if coordinates and coordinates[-1] != polyline.decode(encoded_polyline)[-1]:
            coordinates.append(polyline.decode(encoded_polyline)[-1])

        return coordinates

    def extract_route_info(self, directions_response: Dict) -> Dict:
        """
        Estrae informazioni utili dalla risposta delle directions

        Args:
            directions_response: Risposta completa da Google Maps Directions API

        Returns:
            Dizionario con informazioni semplificate del percorso
        """
        if directions_response['status'] != 'OK':
            raise ValueError(f"Errore Google Maps: {directions_response['status']}")

        route = directions_response['routes'][0]
        leg = route['legs'][0]

        # Estrai la polyline principale
        overview_polyline = route['overview_polyline']['points']

        # Calcola durata e distanza totali
        total_distance = sum(leg['distance']['value'] for leg in route['legs'])
        total_duration = sum(leg['duration']['value'] for leg in route['legs'])

        # Estrai tutti i passi per informazioni dettagliate
        steps = []
        for leg in route['legs']:
            for step in leg['steps']:
                steps.append({
                    'distance': step['distance']['value'],
                    'duration': step['duration']['value'],
                    'start_location': step['start_location'],
                    'end_location': step['end_location'],
                    'polyline': step['polyline']['points'],
                    'instructions': step.get('html_instructions', '')
                })

        return {
            'overview_polyline': overview_polyline,
            'total_distance_meters': total_distance,
            'total_duration_seconds': total_duration,
            'start_address': route['legs'][0]['start_address'],
            'end_address': route['legs'][-1]['end_address'],
            'bounds': route['bounds'],
            'steps': steps,
            'waypoint_order': route.get('waypoint_order', [])
        }

    def create_simulator_path(self,
                              origin: str,
                              destination: str,
                              waypoints: Optional[List[str]] = None,
                              points_density: int = 100,
                              travel_mode: str = "driving",
                              avoid: Optional[List[str]] = None) -> Dict:
        """
        Crea un percorso completo per il simulatore GPS

        Args:
            origin: Punto di partenza
            destination: Punto di arrivo
            waypoints: Punti intermedi
            points_density: Densità dei punti nel percorso
            travel_mode: Modalità di viaggio
            avoid: Elementi da evitare

        Returns:
            Configurazione completa per il simulatore
        """
        # Ottieni il percorso da Google Maps
        directions = self.get_route_from_addresses(
            origin=origin,
            destination=destination,
            waypoints=waypoints,
            travel_mode=travel_mode,
            avoid=avoid
        )

        # Estrai informazioni del percorso
        route_info = self.extract_route_info(directions)

        # Decodifica la polyline in coordinate
        path_coordinates = self.decode_polyline_to_coordinates(
            route_info['overview_polyline'],
            points_density
        )

        # Calcola velocità media suggerita
        avg_speed_ms = route_info['total_distance_meters'] / route_info['total_duration_seconds']
        avg_speed_kmh = avg_speed_ms * 3.6

        # Adatta la velocità al tipo di viaggio
        if travel_mode == "driving":
            suggested_speed = min(max(avg_speed_kmh, 20), 130)  # Tra 20 e 130 km/h
        elif travel_mode == "walking":
            suggested_speed = min(max(avg_speed_kmh, 3), 8)  # Tra 3 e 8 km/h
        elif travel_mode == "bicycling":
            suggested_speed = min(max(avg_speed_kmh, 10), 25)  # Tra 10 e 25 km/h
        else:
            suggested_speed = avg_speed_kmh

        return {
            'path': path_coordinates,
            'route_info': route_info,
            'suggested_speed_kmh': suggested_speed,
            'estimated_duration_minutes': route_info['total_duration_seconds'] / 60,
            'total_distance_km': route_info['total_distance_meters'] / 1000,
            'travel_mode': travel_mode,
            'created_at': datetime.now().isoformat()
        }


def create_simulator_config_with_google_route(
        device_id: str,
        imei: str,
        origin: str,
        destination: str,
        api_key: str,
        waypoints: Optional[List[str]] = None,
        update_interval: int = 30,
        travel_mode: str = "driving",
        avoid: Optional[List[str]] = None,
        traccar_server: str = "http://torraccia.iliadboxos.it:58082"
) -> Dict:
    """
    Crea una configurazione completa per il simulatore usando Google Maps

    Args:
        device_id: ID del dispositivo in Traccar
        imei: IMEI del dispositivo
        origin: Punto di partenza
        destination: Punto di arrivo
        api_key: Chiave API Google Maps
        waypoints: Punti intermedi
        update_interval: Intervallo di aggiornamento in secondi
        travel_mode: Modalità di viaggio
        avoid: Elementi da evitare
        traccar_server: URL del server Traccar

    Returns:
        Configurazione completa per device_simulator.py
    """
    # Crea il generatore di percorsi
    route_generator = GoogleMapsRouteGenerator(api_key)

    # Genera il percorso
    route_data = route_generator.create_simulator_path(
        origin=origin,
        destination=destination,
        waypoints=waypoints,
        travel_mode=travel_mode,
        avoid=avoid
    )

    # Crea la configurazione del simulatore
    config = {
        "traccar_server": traccar_server,
        "devices": [{
            "device_id": device_id,
            "imei": imei,
            "update_interval": update_interval,
            "speed_kmh": int(route_data['suggested_speed_kmh']),
            "simulation_type": "custom",
            "name": f"Google Maps Route: {route_data['route_info']['start_address']} → {route_data['route_info']['end_address']}",
            "path": route_data['path'],
            "route_metadata": {
                "origin": origin,
                "destination": destination,
                "waypoints": waypoints,
                "travel_mode": travel_mode,
                "total_distance_km": route_data['total_distance_km'],
                "estimated_duration_minutes": route_data['estimated_duration_minutes'],
                "start_address": route_data['route_info']['start_address'],
                "end_address": route_data['route_info']['end_address'],
                "created_at": route_data['created_at']
            }
        }],
        "general_settings": {
            "log_level": "INFO",
            "max_retry_attempts": 3,
            "retry_delay_seconds": 5,
            "position_accuracy_meters": 10,
            "simulate_engine_hours": True,
            "simulate_fuel_consumption": True,
            "add_random_variance": True,
            "variance_meters": 20
        }
    }

    return config


# Esempio di utilizzo
if __name__ == "__main__":
    # Esempio di utilizzo con la tua API key
    API_KEY = "YOUR_GOOGLE_MAPS_API_KEY"

    # Crea configurazione per un viaggio da Roma a Milano
    config = create_simulator_config_with_google_route(
        device_id="TEST001",
        imei="123456789012347",
        origin="Roma, Italia",
        destination="Milano, Italia",
        api_key=API_KEY,
        waypoints=["Firenze, Italia"],  # Punto intermedio
        update_interval=30,
        travel_mode="driving",
        avoid=["tolls"]  # Evita pedaggi
    )

    # Salva la configurazione
    with open('google_maps_route_config.json', 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)

    print("Configurazione creata e salvata in 'google_maps_route_config.json'")
    print(f"Percorso: {config['devices'][0]['route_metadata']['start_address']}")
    print(f"Destinazione: {config['devices'][0]['route_metadata']['end_address']}")
    print(f"Distanza: {config['devices'][0]['route_metadata']['total_distance_km']:.1f} km")
    print(f"Durata stimata: {config['devices'][0]['route_metadata']['estimated_duration_minutes']:.0f} minuti")
    print(f"Velocità suggerita: {config['devices'][0]['speed_kmh']} km/h")
    print(f"Punti nel percorso: {len(config['devices'][0]['path'])}")