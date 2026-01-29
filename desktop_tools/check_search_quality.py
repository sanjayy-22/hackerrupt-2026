
import sys
import os
import pandas as pd

# Add project root to path
sys.path.append(os.getcwd())

from SignAvatars.retrieval.indexer import TextIndexer

# Path to the CSV
csv_path = r"c:\Users\user\Downloads\agentathon\SignAvatars\datasets\language2motion\text\how2sign_realigned_train.csv"

def test_search():
    print(f"Initializing Indexer with {csv_path}...")
    try:
        indexer = TextIndexer(csv_path)
    except Exception as e:
        print(f"Failed to initialize indexer: {e}")
        return

    # specific sentence from the CSV (line 2)
    # Target: "And I call them decorative elements because basically all they're meant to do is to enrich and color the page."
    
    # Test 1: Exact match query
    query1 = "And I call them decorative elements because basically all they're meant to do is to enrich and color the page."
    print(f"\nTest 1 Query: '{query1}'")
    results1 = indexer.search(query1, top_k=1)
    if results1:
        print(f"Match: {results1[0]['sentence']}")
        print(f"Score: {results1[0]['score']}")
    else:
        print("No match found.")

    # Test 2: Partial/Imperfect query
    query2 = "decorative elements color page"
    print(f"\nTest 2 Query: '{query2}'")
    results2 = indexer.search(query2, top_k=1)
    if results2:
        print(f"Match: {results2[0]['sentence']}")
        print(f"Score: {results2[0]['score']}")
    else:
        print("No match found.")
        
    # Test 3: Totally different query
    query3 = "flea prevention dogs" # Based on another line observed in previous CSV view
    print(f"\nTest 3 Query: '{query3}'")
    results3 = indexer.search(query3, top_k=1)
    if results3:
        print(f"Match: {results3[0]['sentence']}")
        print(f"Score: {results3[0]['score']}")
    else:
        print("No match found.")

if __name__ == "__main__":
    test_search()
