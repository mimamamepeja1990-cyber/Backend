#!/usr/bin/env python3
"""
Script to inspect and optionally fix `promo_images.url` values that contain
filesystem paths (e.g. Windows paths or absolute server paths) and replace
them with the public URL path `/uploads/promos/<filename>` so the admin UI
and frontend can load them.

Usage:
  python fix_promo_urls.py        # dry-run (shows rows that look problematic)
  python fix_promo_urls.py --apply  # perform updates in DB

Run this on the server where the DB and PROMO_DIR are accessible.
"""
import os
import sys
import argparse

from app.database import SessionLocal
from app import models
from app.main import PROMO_DIR


def looks_filesystem_path(s: str) -> bool:
    if not s:
        return True
    # Contains backslash or a drive letter like C:\ or absolute path starting with / and not web path
    if '\\' in s:
        return True
    if ':' in s and ('\\' in s or '/' in s):
        return True
    # if URL starts with http(s) it's ok
    if s.startswith('http://') or s.startswith('https://'):
        return False
    # if starts with a slash and looks like /uploads/... it's ok
    if s.startswith('/uploads/'):
        return False
    # relative paths like uploads/promos/... treat as filesystem
    if s.startswith('uploads/'):
        return True
    # otherwise if contains os path separator
    if os.path.sep in s:
        return True
    return False


def main(apply: bool = False):
    db = SessionLocal()
    try:
        rows = db.query(models.PromoImage).order_by(models.PromoImage.id).all()
        if not rows:
            print('No promo images found in DB')
            return 0
        fixes = []
        for r in rows:
            url = (r.url or '')
            fname = (r.filename or '')
            file_on_disk = os.path.join(PROMO_DIR, fname) if fname else None
            file_exists = os.path.exists(file_on_disk) if file_on_disk else False
            problem = looks_filesystem_path(url) or (not url and not file_exists)
            print(f'id={r.id} filename={fname} url={url!r} file_exists={file_exists} problem={problem}')
            if problem:
                new_url = f'/uploads/promos/{fname}'
                fixes.append((r.id, new_url))

        if not fixes:
            print('\nNo fixes required')
            return 0

        print(f'\nFound {len(fixes)} rows to fix')
        if not apply:
            print('Run with --apply to perform updates')
            return 0

        # apply updates
        for rid, new_url in fixes:
            rec = db.query(models.PromoImage).filter(models.PromoImage.id == rid).first()
            if rec:
                rec.url = new_url
                db.add(rec)
        db.commit()
        print('Applied fixes')
        return 0
    finally:
        db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true', help='Apply fixes (writes to DB)')
    args = parser.parse_args()
    sys.exit(main(apply=args.apply))
