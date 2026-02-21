#!/usr/bin/env python3
"""
Migrate existing `promo_images` rows to reference DB-backed `images` records.

For each PromoImage row:
 - If `url` already references `/images/{id}`, skip.
 - If an Image row exists with matching `filename`, update PromoImage.url -> `/images/{id}`.
 - Else if a file exists in PROMO_DIR matching `filename`, create an Image row from that file and update PromoImage.url.
 - Otherwise report as missing.

Usage:
  python migrate_promos_to_db_images.py    # dry-run
  python migrate_promos_to_db_images.py --apply   # perform changes

Run on the server (Render) where the DB and PROMO_DIR are accessible.
"""
import os
import sys
import argparse

from app.database import SessionLocal
from app import models
from app.main import PROMO_DIR


def is_images_url(s: str) -> bool:
    if not s:
        return False
    return '/images/' in s


def main(apply: bool = False):
    db = SessionLocal()
    try:
        rows = db.query(models.PromoImage).order_by(models.PromoImage.id).all()
        if not rows:
            print('No promo_images rows found')
            return 0
        to_create = []
        to_update = []
        missing = []
        for r in rows:
            fname = r.filename or ''
            url = (r.url or '')
            if is_images_url(url):
                print(f'id={r.id} filename={fname} -> already images url -> {url}')
                continue
            # try find existing Image by filename
            img = db.query(models.Image).filter(models.Image.filename == fname).first()
            if img:
                new_url = f'/images/{img.id}'
                to_update.append((r.id, new_url))
                print(f'id={r.id} filename={fname} -> will update to existing image id={img.id}')
                continue
            # else if file exists on disk, create Image from file
            path = os.path.join(PROMO_DIR, fname)
            if os.path.exists(path) and os.path.isfile(path):
                to_create.append((r.id, path, fname))
                print(f'id={r.id} filename={fname} -> file exists on disk, will create Image and update')
                continue
            missing.append((r.id, fname))
            print(f'id={r.id} filename={fname} -> MISSING (no DB image and no file on disk)')

        print('\nSummary:')
        print(f'  to_update (use existing Image rows): {len(to_update)}')
        print(f'  to_create (create Image from disk): {len(to_create)}')
        print(f'  missing (no source): {len(missing)}')

        if not apply:
            print('\nRun with --apply to perform the DB updates and creations')
            return 0

        # perform creates
        for rid, path, fname in to_create:
            try:
                with open(path, 'rb') as f:
                    data = f.read()
                img = models.Image(data=data, mime=None, filename=fname)
                db.add(img)
                db.commit()
                db.refresh(img)
                new_url = f'/images/{img.id}'
                rec = db.query(models.PromoImage).filter(models.PromoImage.id == rid).first()
                if rec:
                    rec.url = new_url
                    db.add(rec); db.commit()
                    print(f'Created Image id={img.id} and updated PromoImage id={rid}')
            except Exception as e:
                db.rollback()
                print(f'ERROR creating image from {path}: {e}')

        # perform updates
        for rid, new_url in to_update:
            try:
                rec = db.query(models.PromoImage).filter(models.PromoImage.id == rid).first()
                if rec:
                    rec.url = new_url
                    db.add(rec); db.commit()
                    print(f'Updated PromoImage id={rid} -> {new_url}')
            except Exception as e:
                db.rollback(); print(f'ERROR updating PromoImage id={rid}: {e}')

        print('Migration applied')
        return 0
    finally:
        db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true', help='Apply changes')
    args = parser.parse_args()
    sys.exit(main(apply=args.apply))
