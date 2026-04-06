"""Parse Telegram HTML export into clean text knowledge base."""
import re
import json
from html.parser import HTMLParser

class TelegramHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.messages = []
        self.current_message = None
        self.current_field = None
        self.in_service = False
        self.text_buffer = ""
        self.div_stack = []

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        classes = attrs_dict.get("class", "")

        if tag == "div":
            self.div_stack.append(classes)

            if "message default" in classes or "message default clearfix" in classes:
                self.current_message = {
                    "from": "",
                    "date": "",
                    "text": "",
                    "forwarded_from": "",
                    "forwarded_text": "",
                }
                self.in_service = False

            elif "message service" in classes:
                self.in_service = True
                self.current_message = None

            elif self.current_message is not None:
                if "from_name" in classes:
                    self.current_field = "from_name"
                    self.text_buffer = ""
                elif "text" in classes.split():
                    # Check if we're inside a forwarded body
                    if any("forwarded body" in c for c in self.div_stack):
                        self.current_field = "forwarded_text"
                    else:
                        self.current_field = "text"
                    self.text_buffer = ""
                elif "date details" in classes and "pull_right" in classes:
                    title = attrs_dict.get("title", "")
                    if title and self.current_message:
                        self.current_message["date"] = title
                elif "forwarded body" in classes:
                    pass  # we track this via div_stack

        elif tag == "br":
            if self.current_field:
                self.text_buffer += "\n"

        elif tag == "a" and self.current_field:
            href = attrs_dict.get("href", "")
            if href and not href.startswith("#"):
                self.text_buffer += f" {href} "

    def handle_endtag(self, tag):
        if tag == "div" and self.div_stack:
            classes = self.div_stack.pop()

            if self.current_field and self.current_message:
                clean = self.text_buffer.strip()
                if self.current_field == "from_name":
                    # Only set from if not in forwarded context
                    if any("forwarded body" in c for c in self.div_stack):
                        self.current_message["forwarded_from"] = clean
                    else:
                        self.current_message["from"] = clean
                elif self.current_field == "text":
                    self.current_message["text"] = clean
                elif self.current_field == "forwarded_text":
                    self.current_message["forwarded_text"] = clean
                self.current_field = None
                self.text_buffer = ""

            if ("message default" in classes or "message default clearfix" in classes) and self.current_message:
                # Only add messages with actual text content
                if self.current_message["text"] or self.current_message["forwarded_text"]:
                    self.messages.append(self.current_message)
                self.current_message = None

    def handle_data(self, data):
        if self.current_field:
            self.text_buffer += data

def parse_telegram_html(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        html = f.read()

    parser = TelegramHTMLParser()
    parser.feed(html)
    return parser.messages

def format_knowledge_base(messages):
    """Format messages into a clean text knowledge base."""
    lines = []
    lines.append("=== БАЗА ЗНАНИЙ: Телеграм-чат «Изучение рынка, конкурентов» ===\n")

    for i, msg in enumerate(messages):
        date = msg.get("date", "")
        author = msg.get("from", "Неизвестный")
        text = msg.get("text", "")
        fwd_from = msg.get("forwarded_from", "")
        fwd_text = msg.get("forwarded_text", "")

        # Format date nicely
        date_short = date.split(" UTC")[0] if date else ""

        entry = f"[{date_short}] {author}"

        if fwd_from:
            entry += f" (переслано от {fwd_from})"

        entry += ":\n"

        if fwd_text:
            entry += fwd_text + "\n"
        if text:
            entry += text + "\n"

        lines.append(entry)

    return "\n".join(lines)

if __name__ == "__main__":
    filepath = "/sessions/brave-determined-keller/mnt/ChatExport_2026-03-22_competitors/messages.html"
    messages = parse_telegram_html(filepath)

    # Save as JSON
    with open("/sessions/brave-determined-keller/knowledge_base.json", "w", encoding="utf-8") as f:
        json.dump(messages, f, ensure_ascii=False, indent=2)

    # Save as clean text
    kb_text = format_knowledge_base(messages)
    with open("/sessions/brave-determined-keller/knowledge_base.txt", "w", encoding="utf-8") as f:
        f.write(kb_text)

    print(f"Parsed {len(messages)} messages")
    print(f"Knowledge base size: {len(kb_text)} chars / ~{len(kb_text)//4} tokens")

    # Show first 5 messages
    for msg in messages[:5]:
        print(f"\n--- {msg['from']} ({msg['date'][:20] if msg['date'] else 'no date'}):")
        text = msg['text'] or msg['forwarded_text']
        print(text[:200])
