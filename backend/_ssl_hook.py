import os, sys
if getattr(sys, 'frozen', False):
    ca_path = os.path.join(sys._MEIPASS, 'certifi', 'cacert.pem')
    os.environ['SSL_CERT_FILE'] = ca_path
    os.environ['REQUESTS_CA_BUNDLE'] = ca_path
