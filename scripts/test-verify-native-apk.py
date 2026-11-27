import importlib.util, pathlib, tempfile, unittest, zipfile, io
spec=importlib.util.spec_from_file_location("verify",pathlib.Path(__file__).with_name("verify-native-apk.py"))
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
class TestEmbedded(unittest.TestCase):
    def test_asset_keys(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d);(p/"assets").mkdir();(p/"index.html").write_text('<script type="module" src="/assets/main-abc.js"></script><link rel="stylesheet" href="/assets/main-def.css">')
            for f in ["main-abc.js","main-def.css"]: (p/"assets"/f).write_text("content")
            refs=v.frontend_refs(p)
            self.assertEqual(len(refs),2)
            b=io.BytesIO()
            with zipfile.ZipFile(b,"w") as z: z.writestr("lib/arm64-v8a/libds_mobile_digital_hub_lib.so",b"\x7fELFindex.html\0assets/main-abc.js\0assets/main-def.css")
            with zipfile.ZipFile(b) as z: self.assertEqual(len(v.verify_embedded(z,refs)),1)
            (p/"assets/main-def.css").unlink()
            with self.assertRaises(ValueError): v.frontend_refs(p)
    def test_rejects_missing_embedding(self):
        b=io.BytesIO()
        with zipfile.ZipFile(b,"w") as z: z.writestr("lib/arm64-v8a/libds_mobile_digital_hub_lib.so",b"\x7fELFindex.html")
        with zipfile.ZipFile(b) as z:
            with self.assertRaises(ValueError): v.verify_embedded(z,["assets/main.js","assets/main.css"])
    def test_rejects_invalid_elf(self):
        b=io.BytesIO()
        with zipfile.ZipFile(b,"w") as z: z.writestr("lib/arm64-v8a/libds_mobile_digital_hub_lib.so",b"index.html assets/main.js assets/main.css")
        with zipfile.ZipFile(b) as z:
            with self.assertRaises(ValueError): v.verify_embedded(z,["assets/main.js","assets/main.css"])
if __name__=="__main__": unittest.main()
