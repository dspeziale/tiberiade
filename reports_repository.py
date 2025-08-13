# reports_repository.py - Sistema di gestione repository reports

import os
import json
import datetime
from pathlib import Path
from flask import Blueprint, request, jsonify, send_file, render_template
from werkzeug.utils import secure_filename
import uuid
import zipfile
import io

# Configurazione
REPORTS_DIR = Path("reports")
METADATA_FILE = REPORTS_DIR / "metadata.json"

# Crea directory se non esiste
REPORTS_DIR.mkdir(exist_ok=True)

# Blueprint per le route
reports_repo_bp = Blueprint('reports_repo', __name__)


class ReportsRepository:
    def __init__(self):
        self.metadata_file = METADATA_FILE
        self.reports_dir = REPORTS_DIR
        self._ensure_metadata_exists()

    def _ensure_metadata_exists(self):
        """Crea il file metadata se non esiste"""
        if not self.metadata_file.exists():
            initial_data = {
                "reports": [],
                "stats": {
                    "total_reports": 0,
                    "total_size_mb": 0,
                    "last_cleanup": None
                },
                "created_at": datetime.datetime.now().isoformat()
            }
            self._save_metadata(initial_data)

    def _load_metadata(self):
        """Carica metadata dal file JSON"""
        try:
            with open(self.metadata_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            self._ensure_metadata_exists()
            return self._load_metadata()

    def _save_metadata(self, data):
        """Salva metadata nel file JSON"""
        with open(self.metadata_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False, default=str)

    def save_report(self, report_data, filename=None):
        """Salva un report nel repository"""
        try:
            # Genera filename se non fornito
            if not filename:
                timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
                report_type = report_data.get('type', 'unknown')
                filename = f"report_{report_type}_{timestamp}.json"

            # Assicura che il filename sia sicuro
            filename = secure_filename(filename)
            if not filename.endswith('.json'):
                filename += '.json'

            # Percorso completo del file
            filepath = self.reports_dir / filename

            # Genera ID univoco per il report
            report_id = str(uuid.uuid4())

            # Prepara i dati del report con metadata
            report_with_metadata = {
                "id": report_id,
                "filename": filename,
                "created_at": datetime.datetime.now().isoformat(),
                "type": report_data.get('type', 'unknown'),
                "title": report_data.get('title', f"Report {report_data.get('type', 'Unknown')}"),
                "description": report_data.get('description', ''),
                "devices_count": len(report_data.get('data', [])),
                "period": report_data.get('period', {}),
                "totals": report_data.get('totals', {}),
                "data": report_data.get('data', []),
                "generated_by": report_data.get('generated_by', 'System'),
                "file_size": 0  # Sarà calcolato dopo il salvataggio
            }

            # Salva il file del report
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(report_with_metadata, f, indent=2, ensure_ascii=False, default=str)

            # Calcola la dimensione del file
            file_size = filepath.stat().st_size
            report_with_metadata['file_size'] = file_size

            # Aggiorna metadata
            metadata = self._load_metadata()

            # Crea entry per l'indice
            report_entry = {
                "id": report_id,
                "filename": filename,
                "title": report_with_metadata['title'],
                "type": report_with_metadata['type'],
                "created_at": report_with_metadata['created_at'],
                "devices_count": report_with_metadata['devices_count'],
                "file_size": file_size,
                "description": report_with_metadata['description']
            }

            metadata['reports'].append(report_entry)
            metadata['stats']['total_reports'] += 1
            metadata['stats']['total_size_mb'] = round(
                sum(r['file_size'] for r in metadata['reports']) / (1024 * 1024), 2
            )

            self._save_metadata(metadata)

            return {
                "success": True,
                "report_id": report_id,
                "filename": filename,
                "message": f"Report salvato con successo: {filename}"
            }

        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "message": f"Errore nel salvataggio del report: {str(e)}"
            }

    def get_reports_list(self, limit=None, report_type=None):
        """Ottiene la lista dei reports salvati"""
        metadata = self._load_metadata()
        reports = metadata['reports']

        # Filtra per tipo se specificato
        if report_type:
            reports = [r for r in reports if r['type'] == report_type]

        # Ordina per data di creazione (più recenti primi)
        reports.sort(key=lambda x: x['created_at'], reverse=True)

        # Limita i risultati se specificato
        if limit:
            reports = reports[:limit]

        return {
            "reports": reports,
            "stats": metadata['stats'],
            "total_count": len(metadata['reports'])
        }

    def get_report(self, report_id):
        """Ottiene un report specifico per ID"""
        try:
            metadata = self._load_metadata()
            report_entry = next((r for r in metadata['reports'] if r['id'] == report_id), None)

            if not report_entry:
                return {"success": False, "error": "Report non trovato"}

            filepath = self.reports_dir / report_entry['filename']

            if not filepath.exists():
                return {"success": False, "error": "File del report non trovato"}

            with open(filepath, 'r', encoding='utf-8') as f:
                report_data = json.load(f)

            return {
                "success": True,
                "report": report_data
            }

        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }

    def delete_report(self, report_id):
        """Elimina un report"""
        try:
            metadata = self._load_metadata()
            report_entry = next((r for r in metadata['reports'] if r['id'] == report_id), None)

            if not report_entry:
                return {"success": False, "error": "Report non trovato"}

            # Elimina il file
            filepath = self.reports_dir / report_entry['filename']
            if filepath.exists():
                filepath.unlink()

            # Rimuovi dall'indice
            metadata['reports'] = [r for r in metadata['reports'] if r['id'] != report_id]
            metadata['stats']['total_reports'] = len(metadata['reports'])
            metadata['stats']['total_size_mb'] = round(
                sum(r['file_size'] for r in metadata['reports']) / (1024 * 1024), 2
            )

            self._save_metadata(metadata)

            return {
                "success": True,
                "message": "Report eliminato con successo"
            }

        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }

    def cleanup_old_reports(self, days_old=30):
        """Elimina reports più vecchi di X giorni"""
        try:
            cutoff_date = datetime.datetime.now() - datetime.timedelta(days=days_old)
            metadata = self._load_metadata()

            reports_to_delete = []
            for report in metadata['reports']:
                created_at = datetime.datetime.fromisoformat(report['created_at'])
                if created_at < cutoff_date:
                    reports_to_delete.append(report)

            deleted_count = 0
            for report in reports_to_delete:
                result = self.delete_report(report['id'])
                if result['success']:
                    deleted_count += 1

            # Aggiorna data ultimo cleanup
            metadata = self._load_metadata()
            metadata['stats']['last_cleanup'] = datetime.datetime.now().isoformat()
            self._save_metadata(metadata)

            return {
                "success": True,
                "deleted_count": deleted_count,
                "message": f"Eliminati {deleted_count} reports vecchi"
            }

        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }

    def export_all_reports(self):
        """Crea un file ZIP con tutti i reports"""
        try:
            zip_buffer = io.BytesIO()

            with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
                # Aggiungi il file metadata
                zip_file.write(self.metadata_file, "metadata.json")

                # Aggiungi tutti i files dei reports
                for report_file in self.reports_dir.glob("*.json"):
                    if report_file.name != "metadata.json":
                        zip_file.write(report_file, f"reports/{report_file.name}")

            zip_buffer.seek(0)

            return {
                "success": True,
                "zip_data": zip_buffer.getvalue(),
                "filename": f"traccar_reports_backup_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
            }

        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }


# Istanza globale del repository
repo = ReportsRepository()


# ==================== ROUTES API ====================

@reports_repo_bp.route('/api/reports', methods=['GET'])
def api_get_reports():
    """API per ottenere la lista dei reports"""
    limit = request.args.get('limit', type=int)
    report_type = request.args.get('type')

    result = repo.get_reports_list(limit=limit, report_type=report_type)
    return jsonify(result)


@reports_repo_bp.route('/api/reports', methods=['POST'])
def api_save_report():
    """API per salvare un nuovo report"""
    try:
        data = request.get_json()

        if not data:
            return jsonify({"success": False, "error": "Dati mancanti"}), 400

        filename = request.args.get('filename')
        result = repo.save_report(data, filename)

        status_code = 201 if result['success'] else 400
        return jsonify(result), status_code

    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@reports_repo_bp.route('/api/reports/<report_id>', methods=['GET'])
def api_get_report(report_id):
    """API per ottenere un report specifico"""
    result = repo.get_report(report_id)
    status_code = 200 if result['success'] else 404
    return jsonify(result), status_code


@reports_repo_bp.route('/api/reports/<report_id>', methods=['DELETE'])
def api_delete_report(report_id):
    """API per eliminare un report"""
    result = repo.delete_report(report_id)
    status_code = 200 if result['success'] else 404
    return jsonify(result), status_code


@reports_repo_bp.route('/api/reports/<report_id>/download', methods=['GET'])
def api_download_report(report_id):
    """API per scaricare un report"""
    result = repo.get_report(report_id)

    if not result['success']:
        return jsonify(result), 404

    # Trova il file fisico
    metadata = repo._load_metadata()
    report_entry = next((r for r in metadata['reports'] if r['id'] == report_id), None)

    if not report_entry:
        return jsonify({"success": False, "error": "Report non trovato"}), 404

    filepath = repo.reports_dir / report_entry['filename']

    if not filepath.exists():
        return jsonify({"success": False, "error": "File non trovato"}), 404

    return send_file(
        filepath,
        as_attachment=True,
        download_name=report_entry['filename'],
        mimetype='application/json'
    )


@reports_repo_bp.route('/api/reports/export/all', methods=['GET'])
def api_export_all_reports():
    """API per esportare tutti i reports in un ZIP"""
    result = repo.export_all_reports()

    if not result['success']:
        return jsonify(result), 500

    return send_file(
        io.BytesIO(result['zip_data']),
        as_attachment=True,
        download_name=result['filename'],
        mimetype='application/zip'
    )


@reports_repo_bp.route('/api/reports/cleanup', methods=['POST'])
def api_cleanup_reports():
    """API per pulire reports vecchi"""
    days_old = request.args.get('days', 30, type=int)
    result = repo.cleanup_old_reports(days_old)
    return jsonify(result)


# ==================== ROUTE WEB ====================

@reports_repo_bp.route('/reports/repository')
def reports_repository_page():
    """Pagina web per gestire il repository dei reports"""
    return render_template('reports_repository.html')


# ==================== FUNZIONI DI UTILITÀ ====================

def init_reports_repository(app):
    """Inizializza il sistema di repository reports"""
    app.register_blueprint(reports_repo_bp)

    # Crea directory se non esiste
    REPORTS_DIR.mkdir(exist_ok=True)

    print(f"✅ Reports Repository inizializzato in: {REPORTS_DIR.absolute()}")
    return repo
