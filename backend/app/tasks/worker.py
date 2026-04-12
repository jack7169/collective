from huey import SqliteHuey

from app.config import get_settings

settings = get_settings()
huey = SqliteHuey(filename=f"{settings.CONFIG_DIR}/huey.db")

# Import task modules so Huey's registry can find them
import app.tasks.scan_tasks  # noqa: F401, E402
import app.tasks.action_tasks  # noqa: F401, E402
import app.tasks.session_tasks  # noqa: F401, E402
