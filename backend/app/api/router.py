from fastapi import APIRouter

from app.api.actions import router as actions_router
from app.api.browse import router as browse_router
from app.api.compare import router as compare_router
from app.api.results import router as results_router
from app.api.scans import router as scans_router
from app.api.scheduler import router as scheduler_router
from app.api.system import router as system_router

api_router = APIRouter(prefix="/api")

api_router.include_router(scans_router)
api_router.include_router(results_router)
api_router.include_router(compare_router)
api_router.include_router(actions_router)
api_router.include_router(browse_router)
api_router.include_router(scheduler_router)
api_router.include_router(system_router)
