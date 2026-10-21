"""
Application launching and shell command execution.
Uses predefined allowlist for security.
"""
import subprocess
import os
import shlex


class AppActions:
    def __init__(self):
        # Predefined applications (desktop file names or commands)
        self.apps = {
            "terminal": ["gnome-terminal"],
            "code": ["code"],  # VS Code
            "files": ["nautilus"],
            "browser": ["firefox"],
            "chrome": ["google-chrome"],
            "canva": ["canva"],  # If installed as PWA or app
            "figma": ["figma"],  # If installed as PWA or app
            "gimp": ["gimp"],
            "inkscape": ["inkscape"],
            "settings": ["gnome-control-center"],
            "calculator": ["gnome-calculator"],
            "text_editor": ["gedit"],
        }

        # Predefined shell commands (allowlist only)
        self.commands = {
            "git_status": ["git", "status"],
            "git_add": ["git", "add", "."],
            "git_commit": ["git", "commit", "-m", "Quick commit from DeskPad"],
            "git_push": ["git", "push"],
            "git_pull": ["git", "pull"],
            "git_log": ["git", "log", "--oneline", "-10"],
            "make_build": ["make"],
            "npm_build": ["npm", "run", "build"],
            "npm_test": ["npm", "test"],
            "pytest": ["pytest"],
            "cargo_build": ["cargo", "build"],
            "go_build": ["go", "build"],
            "docker_up": ["docker-compose", "up", "-d"],
            "docker_down": ["docker-compose", "down"],
            "seek": ["playerctl", "position", "10+", "--player=spotify"],  # Example
        }

    def launch(self, app_id):
        """Launch an application by ID"""
        if app_id not in self.apps:
            return {"error": f"Unknown app: {app_id}"}

        cmd = self.apps[app_id]
        try:
            # Use subprocess.Popen for non-blocking launch
            subprocess.Popen(cmd, start_new_session=True)
            return {"action": "app_launch", "app": app_id}
        except FileNotFoundError:
            return {"error": f"App not found: {cmd[0]}"}
        except Exception as e:
            return {"error": f"Launch failed: {e}"}

    def run_command(self, cmd_id):
        """Run a predefined shell command"""
        if cmd_id not in self.commands:
            return {"error": f"Unknown command: {cmd_id}"}

        cmd = self.commands[cmd_id]
        try:
            # Run with timeout, capture output
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,
                cwd=os.path.expanduser("~")  # Run in home dir by default
            )
            return {
                "action": "shell",
                "command": cmd_id,
                "exit_code": result.returncode,
                "stdout": result.stdout[:500],  # Limit output
                "stderr": result.stderr[:500],
            }
        except subprocess.TimeoutExpired:
            return {"error": "Command timeout (30s)"}
        except FileNotFoundError:
            return {"error": f"Command not found: {cmd[0]}"}
        except Exception as e:
            return {"error": f"Command failed: {e}"}

    def register_app(self, app_id, command):
        """Register a custom app (for config use)"""
        self.apps[app_id] = command if isinstance(command, list) else shlex.split(command)

    def register_command(self, cmd_id, command):
        """Register a custom shell command (for config use)"""
        self.commands[cmd_id] = command if isinstance(command, list) else shlex.split(command)