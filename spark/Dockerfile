FROM apache/spark:3.5.1
USER root
RUN pip install --no-cache-dir pandas pyarrow vaderSentiment transformers
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
