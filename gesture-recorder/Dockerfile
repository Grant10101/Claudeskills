FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV BASE_PATH=/gestures \
    GESTURE_DIR=/data/gestures \
    PORT=8000
VOLUME ["/data/gestures"]
EXPOSE 8000
CMD ["python", "app.py"]
