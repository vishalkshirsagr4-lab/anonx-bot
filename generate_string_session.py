"""Interactively create a Pyrogram user session string for VPS deployment."""

import asyncio
import os

from dotenv import load_dotenv
from pyrogram import Client


async def main() -> None:
    load_dotenv()
    api_id = os.getenv("API_ID", "").strip()
    api_hash = os.getenv("API_HASH", "").strip()
    if not api_id or not api_hash:
        raise SystemExit("Set API_ID and API_HASH in .env before running this script.")
    client = Client("session-generator", api_id=int(api_id), api_hash=api_hash, in_memory=True)
    async with client:
        print("STRING_SESSION (store this securely; anyone holding it controls the account):")
        print(await client.export_session_string())


if __name__ == "__main__":
    asyncio.run(main())
