import json
import os
from flask import Flask, request, jsonify
from datetime import datetime


class SettingsManager:
    def __init__(self, settings_file='config/settings.json'):
        self.settings_file = settings_file
        self.default_settings = {
            # Impostazioni Generali
            'appName': 'Tracker Dashboard',
            'appVersion': '2.1.0',
            'language': 'it',
            'timezone': 'Europe/Rome',
            'defaultMapType': 'osm',
            'defaultZoom': 10,
            'autoRefreshInterval': 30,
            'enableAutoRefresh': True,

            # Impostazioni Server
            'traccarServer': 'http://torraccia.iliadboxos.it:59000',
            'connectionTimeout': 30,
            'cacheTtl': 60,
            'enableHttps': False,
            'enableCors': True,

            # Impostazioni Notifiche
            'enableNotifications': True,
            'soundNotifications': False,
            'emailNotifications': False,
            'notificationDuration': 5000,
            'notificationPosition': 'top-right',
            'offlineAlerts': True,
            'speedingAlerts': True,
            'geofenceAlerts': False,
            'offlineThreshold': 5,
            'speedLimit': 130,

            # Impostazioni Aspetto
            'theme': 'light',
            'accentColor': 'primary',
            'compactMode': False,
            'sidebarCollapsed': False,
            'fontSize': 'normal',
            'animations': 'full'
        }
        self.ensure_settings_file()

    def ensure_settings_file(self):
        """Crea il file di impostazioni se non esiste"""
        # Crea la directory se non esiste
        os.makedirs(os.path.dirname(self.settings_file), exist_ok=True)

        if not os.path.exists(self.settings_file):
            self.save_settings(self.default_settings)

    def load_settings(self):
        """Carica le impostazioni dal file JSON"""
        try:
            with open(self.settings_file, 'r', encoding='utf-8') as f:
                settings = json.load(f)

            # Merge con le impostazioni di default per eventuali nuove chiavi
            merged_settings = self.default_settings.copy()
            merged_settings.update(settings)

            return merged_settings

        except (FileNotFoundError, json.JSONDecodeError) as e:
            print(f"Errore nel caricamento delle impostazioni: {e}")
            return self.default_settings.copy()

    def save_settings(self, settings):
        """Salva le impostazioni nel file JSON"""
        try:
            # Aggiungi timestamp dell'ultimo salvataggio
            settings['lastUpdated'] = datetime.now().isoformat()

            with open(self.settings_file, 'w', encoding='utf-8') as f:
                json.dump(settings, f, indent=4, ensure_ascii=False)

            return True

        except Exception as e:
            print(f"Errore nel salvataggio delle impostazioni: {e}")
            return False

    def get_setting(self, key, default=None):
        """Ottiene una singola impostazione"""
        settings = self.load_settings()
        return settings.get(key, default)

    def update_setting(self, key, value):
        """Aggiorna una singola impostazione"""
        settings = self.load_settings()
        settings[key] = value
        return self.save_settings(settings)

    def reset_to_defaults(self):
        """Ripristina le impostazioni di default"""
        return self.save_settings(self.default_settings.copy())

    def validate_settings(self, settings):
        """Valida le impostazioni ricevute"""
        errors = []

        # Validazione numerica
        numeric_fields = {
            'defaultZoom': (1, 20),
            'autoRefreshInterval': (5, 300),
            'connectionTimeout': (5, 300),
            'cacheTtl': (10, 3600),
            'notificationDuration': (1000, 30000),
            'offlineThreshold': (1, 60),
            'speedLimit': (10, 300)
        }

        for field, (min_val, max_val) in numeric_fields.items():
            if field in settings:
                try:
                    value = int(settings[field])
                    if not (min_val <= value <= max_val):
                        errors.append(f"{field} deve essere tra {min_val} e {max_val}")
                except ValueError:
                    errors.append(f"{field} deve essere un numero valido")

        # Validazione URL
        if 'traccarServer' in settings:
            url = settings['traccarServer']
            if not (url.startswith('http://') or url.startswith('https://')):
                errors.append("URL del server Traccar deve iniziare con http:// o https://")

        # Validazione enum
        valid_themes = ['light', 'dark', 'auto']
        if 'theme' in settings and settings['theme'] not in valid_themes:
            errors.append(f"Tema deve essere uno di: {', '.join(valid_themes)}")

        valid_languages = ['it', 'en', 'es', 'fr']
        if 'language' in settings and settings['language'] not in valid_languages:
            errors.append(f"Lingua deve essere una di: {', '.join(valid_languages)}")

        return errors


# Inizializza il gestore delle impostazioni
settings_manager = SettingsManager()


# Route Flask per l'API delle impostazioni
def setup_settings_routes(app):
    @app.route('/api/settings', methods=['GET'])
    def get_settings():
        """Endpoint per ottenere tutte le impostazioni"""
        try:
            settings = settings_manager.load_settings()
            return jsonify({
                'success': True,
                'settings': settings
            })
        except Exception as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500

    @app.route('/api/settings', methods=['POST'])
    def save_settings():
        """Endpoint per salvare le impostazioni"""
        try:
            data = request.get_json()

            if not data:
                return jsonify({
                    'success': False,
                    'error': 'Dati non validi'
                }), 400

            # Valida le impostazioni
            errors = settings_manager.validate_settings(data)
            if errors:
                return jsonify({
                    'success': False,
                    'errors': errors
                }), 400

            # Carica le impostazioni attuali e aggiorna solo i campi forniti
            current_settings = settings_manager.load_settings()
            current_settings.update(data)

            # Salva le impostazioni
            if settings_manager.save_settings(current_settings):
                return jsonify({
                    'success': True,
                    'message': 'Impostazioni salvate con successo'
                })
            else:
                return jsonify({
                    'success': False,
                    'error': 'Errore nel salvataggio'
                }), 500

        except Exception as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500

    @app.route('/api/settings/<key>', methods=['GET'])
    def get_setting(key):
        """Endpoint per ottenere una singola impostazione"""
        try:
            value = settings_manager.get_setting(key)
            if value is not None:
                return jsonify({
                    'success': True,
                    'key': key,
                    'value': value
                })
            else:
                return jsonify({
                    'success': False,
                    'error': 'Impostazione non trovata'
                }), 404

        except Exception as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500

    @app.route('/api/settings/<key>', methods=['PUT'])
    def update_setting(key):
        """Endpoint per aggiornare una singola impostazione"""
        try:
            data = request.get_json()

            if 'value' not in data:
                return jsonify({
                    'success': False,
                    'error': 'Valore mancante'
                }), 400

            # Valida la singola impostazione
            temp_settings = {key: data['value']}
            errors = settings_manager.validate_settings(temp_settings)
            if errors:
                return jsonify({
                    'success': False,
                    'errors': errors
                }), 400

            if settings_manager.update_setting(key, data['value']):
                return jsonify({
                    'success': True,
                    'message': f'Impostazione {key} aggiornata'
                })
            else:
                return jsonify({
                    'success': False,
                    'error': 'Errore nell\'aggiornamento'
                }), 500

        except Exception as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500

    @app.route('/api/settings/reset', methods=['POST'])
    def reset_settings():
        """Endpoint per ripristinare le impostazioni di default"""
        try:
            if settings_manager.reset_to_defaults():
                return jsonify({
                    'success': True,
                    'message': 'Impostazioni ripristinate ai valori di default'
                })
            else:
                return jsonify({
                    'success': False,
                    'error': 'Errore nel ripristino'
                }), 500

        except Exception as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500


# Esempio di utilizzo nell'app Flask principale
if __name__ == '__main__':
    app = Flask(__name__)
    setup_settings_routes(app)

    # Test delle funzionalità
    print("Testing SettingsManager...")

    # Carica impostazioni
    settings = settings_manager.load_settings()
    print(f"Impostazioni caricate: {len(settings)} elementi")

    # Test salvataggio
    test_settings = settings.copy()
    test_settings['appName'] = 'Test Dashboard'
    if settings_manager.save_settings(test_settings):
        print("Test salvataggio: OK")

    # Test validazione
    invalid_settings = {'defaultZoom': 25}  # Fuori range
    errors = settings_manager.validate_settings(invalid_settings)
    print(f"Test validazione: {'OK' if errors else 'FAILED'}")