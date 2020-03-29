import logging
import pathlib

import aiofiles
from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from starlette.websockets import WebSocketDisconnect
from .koalachat import KoalaChat

logger = logging.getLogger(__name__)

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")

koalachat = KoalaChat()

@app.get("/")
async def index():
    index_path = 'static/index.html'
    async with aiofiles.open(index_path) as f:
        html = await f.read()
    return HTMLResponse(html)

@app.websocket('/ws/')
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    await koalachat.add_client(websocket)
    logger.info('initial ws client.state = %s', websocket.client_state)
    while True:
        try:
            msg = await websocket.receive_json()
        except WebSocketDisconnect:
            await koalachat.remove_client(websocket)
            break
        logger.info('got websocket msg %s', msg)
        await koalachat.handle_message(msg)


