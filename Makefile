run:
	pipenv run uvicorn main:app \
		--port=11001 \
		--host=0.0.0.0 \
		--log-level=info \
		--reload
