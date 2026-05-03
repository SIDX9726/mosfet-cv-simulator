import axios from 'axios';

const API_URL = 'http://127.0.0.1:8000';

export const generateCVCurve = async (params) => {
    try {
        const response = await axios.post(`${API_URL}/generate-cv`, params);
        return response.data.data;
    } catch (error) {
        console.error("Error fetching CV data:", error);
        return null;
    }
};

export const uploadDataFile = async (file) => {
    const formData = new FormData();
    formData.append("file", file);

    try {
        const response = await axios.post(`${API_URL}/upload-data`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
        return response.data.data;
    } catch (error) {
        console.error("Error uploading file:", error);
        return null;
    }
};

export const analyzeMeasurement = async (payload) => {
    try {
        const response = await axios.post(`${API_URL}/analyze-data`, payload);
        return response.data.data;
    } catch (error) {
        console.error("Error analyzing data:", error);
        return null;
    }
};