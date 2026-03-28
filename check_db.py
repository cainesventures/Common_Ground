import sqlite3
conn = sqlite3.connect('common_ground_test.db')
cursor = conn.cursor()
cursor.execute('SELECT name FROM sqlite_master WHERE type="table"')
tables = [row[0] for row in cursor.fetchall()]
print('Tables:', tables)
if 'debates' in tables:
    cursor.execute('SELECT COUNT(*) FROM debates')
    print('Total debates:', cursor.fetchone()[0])
    cursor.execute('SELECT id FROM debates')
    result = cursor.fetchone()
    if result:
        print('Debate ID:', result[0])
conn.close()