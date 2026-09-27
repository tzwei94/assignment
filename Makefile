.PHONY: verify app deployment smoke
verify: app deployment
app:
	$(MAKE) -C app verify
deployment:
	$(MAKE) -C deployment verify
smoke:
	$(MAKE) -C app smoke
