"""
Macro execution - sequences of actions with delays.
Runs actions sequentially with configurable delays between steps.
"""
import time
import threading


class MacroActions:
    def __init__(self, keyboard, media, mouse, volume, brightness, scroll, zoom, apps):
        self.handlers = {
            "keypress": keyboard,
            "shortcut": keyboard,
            "text": keyboard,
            "media": media,
            "mouse": mouse,
            "volume": volume,
            "brightness": brightness,
            "scroll": scroll,
            "zoom": zoom,
            "app": apps,
            "shell": apps,
        }

# Predefined macros
        self.macros = {
            "duplicate_line": [
                {"type": "shortcut", "params": {"combo": "Home"}},
                {"type": "shortcut", "params": {"combo": "Shift+End"}},
                {"type": "shortcut", "params": {"combo": "Ctrl+C"}},
                {"type": "shortcut", "params": {"combo": "End"}},
                {"type": "keypress", "params": {"key": "Enter"}},
                {"type": "shortcut", "params": {"combo": "Ctrl+V"}},
            ],
            "select_word": [
                {"type": "shortcut", "params": {"combo": "Ctrl+Left"}},
                {"type": "shortcut", "params": {"combo": "Ctrl+Shift+Right"}},
            ],
            "save_all": [
                {"type": "shortcut", "params": {"combo": "Ctrl+S"}},
                {"type": "wait", "params": {"ms": 200}},
                {"type": "shortcut", "params": {"combo": "Ctrl+Shift+S"}},
            ],
            "copy_file_path": [
                {"type": "shortcut", "params": {"combo": "Ctrl+L"}},
                {"type": "shortcut", "params": {"combo": "Ctrl+C"}},
            ],
            "new_terminal_tab": [
                {"type": "shortcut", "params": {"combo": "Ctrl+Shift+T"}},
            ],
            "close_tab": [
                {"type": "shortcut", "params": {"combo": "Ctrl+W"}},
            ],
            "reopen_closed_tab": [
                {"type": "shortcut", "params": {"combo": "Ctrl+Shift+T"}},
            ],
            "vim_space_s_a": [
                {"type": "keypress", "params": {"key": " "}},
                {"type": "wait", "params": {"ms": 50}},
                {"type": "keypress", "params": {"key": "s"}},
                {"type": "wait", "params": {"ms": 50}},
                {"type": "keypress", "params": {"key": "a"}},
            ],
            "vim_wq": [
                {"type": "text", "params": {"text": ":wq"}},
                {"type": "keypress", "params": {"key": "Enter"}},
            ],
        }

    def run(self, macro_id):
        """Run a macro by ID"""
        if macro_id not in self.macros:
            return {"error": f"Unknown macro: {macro_id}"}

        steps = self.macros[macro_id]
        results = []

        for step in steps:
            step_type = step.get("type")
            params = step.get("params", {})

            if step_type == "wait":
                ms = params.get("ms", 100)
                time.sleep(min(ms / 1000.0, 5.0))  # Cap at 5 seconds
                results.append({"type": "wait", "ms": ms})
                continue

            if step_type not in self.handlers:
                results.append({"type": step_type, "error": f"Unknown step type: {step_type}"})
                continue

            handler = self.handlers[step_type]
            method_name = "press_key" if step_type == "keypress" else \
                          "press_combo" if step_type == "shortcut" else \
                          "type_text" if step_type == "text" else \
                          "control" if step_type in ("media", "mouse") else \
                          "adjust" if step_type in ("volume", "brightness", "scroll", "zoom") else \
                          "launch" if step_type == "app" else \
                          "run_command"

            method = getattr(handler, method_name, None)
            if not method:
                results.append({"type": step_type, "error": f"No handler method for {step_type}"})
                continue

            try:
                result = method(**params)
                results.append({"type": step_type, "result": result})
            except Exception as e:
                results.append({"type": step_type, "error": str(e)})

            # Small delay between steps to avoid flooding
            time.sleep(0.05)

        return {"action": "macro", "macro": macro_id, "steps": len(steps), "results": results}

    def register_macro(self, macro_id, steps):
        """Register a custom macro (for config use)"""
        self.macros[macro_id] = steps

    def get_macros(self):
        """Get list of available macros"""
        return list(self.macros.keys())