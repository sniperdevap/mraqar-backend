import { Request, Response } from 'express';
import * as adService from './ad.service';
import asyncHandler from '../../utils/async-handler';
import { formatResponse } from '../../utils/helpers';
import { JwtPayload } from 'jsonwebtoken';
import * as accountService from '../user/account.service';
import { saveFailedAd } from '../failed-ad/failed-ad.service';

export const createAd = asyncHandler(async (req: Request, res: Response) => {
    const user = req.user as JwtPayload;

    const adData = {
        ...req.body,
        user: user.role === 'super_admin' && req.query.userId ? (req.query.userId as string) : user.id
    };

    try {
        const ad = await adService.createAd(adData);

        // Check wishlist matches asynchronously (fire & forget)
        accountService.checkWishlistMatches(ad._id.toString()).catch((err: Error) => console.error('Error checking wishlist matches:', err));

        res.status(201).json(formatResponse(true, 'Ad created successfully', ad));
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        // Save failed ad attempt for admin review
        await saveFailedAd(adData, errorMessage);
        throw error;
    }
});

export const getAds = asyncHandler(async (req: Request, res: Response) => {
    const { page, limit, purpose, propertyType, area, minPrice, maxPrice } = req.query;
    // User is optional - route is public but can have optional auth
    const user = req.user as JwtPayload | undefined;

    // Handle area parameter - check for both 'area' and 'area[]' formats
    let areaParam: string | string[] | undefined = undefined;
    if (area) {
        if (Array.isArray(area)) {
            areaParam = area as string[];
        } else {
            areaParam = area as string;
        }
    } else if (req.query['area[]']) {
        // Handle bracket notation: area[]=value1&area[]=value2
        const areaArray = req.query['area[]'];
        areaParam = Array.isArray(areaArray) ? (areaArray as string[]) : [areaArray as string];
    }

    const params = {
        page: page ? parseInt(page as string) : undefined,
        limit: limit ? parseInt(limit as string) : undefined,
        purpose: purpose as string,
        propertyType: propertyType as string,
        area: areaParam,
        minPrice: minPrice ? parseFloat(minPrice as string) : undefined,
        maxPrice: maxPrice ? parseFloat(maxPrice as string) : undefined,
        userId: user?.id
    };

    // Always return user ads first if userId provided
    const result = await adService.getAds(params);
    res.status(200).json(formatResponse(true, 'Ads fetched successfully', result));
});

export const getAd = asyncHandler(async (req: Request, res: Response) => {
    const user = req.user as JwtPayload | undefined;
    const ad = await adService.getAdByIdAggregated(req.params.id as string, user?.id);
    if (!ad) {
        return res.status(404).json(formatResponse(false, 'Ad not found'));
    }

    res.status(200).json(formatResponse(true, 'Ad fetched successfully', ad));
});

export const countAdView = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;

    const ip = req.ip || (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';

    const result = await adService.countAdView(id, ip);
    if (!result) {
        return res.status(404).json(formatResponse(false, 'Ad not found'));
    }

    res.status(200).json(formatResponse(true, result.counted ? 'View counted' : 'View already counted', result));
});

export const updateAd = asyncHandler(async (req: Request, res: Response) => {
    const user = req.user as JwtPayload;
    const id = req.params.id as string;

    // Check ownership
    const existingAd = await adService.getAdById(id);
    if (!existingAd) {
        return res.status(404).json(formatResponse(false, 'Ad not found'));
    }

    // existingAd.user is populated, so we need to access _id or id
    // Depending on mongoose version/population, it is safer to compare strings
    const adOwnerId = (existingAd.user as any)._id ? (existingAd.user as any)._id.toString() : existingAd.user.toString();

    if (adOwnerId !== user.id && user.role !== 'super_admin') {
        return res.status(403).json(formatResponse(false, 'Not authorized to update this ad'));
    }

    if (user.role === 'super_admin' && req.query.userId) {
        req.body.user = req.query.userId as string;
    }

    const updatedAd = await adService.updateAd(id, req.body);
    res.status(200).json(formatResponse(true, 'Ad updated successfully', updatedAd));
});

export const deleteAd = asyncHandler(async (req: Request, res: Response) => {
    const user = req.user as JwtPayload;
    const id = req.params.id as string;

    // Check ownership
    const existingAd = await adService.getAdById(id);
    if (!existingAd) {
        return res.status(404).json(formatResponse(false, 'Ad not found'));
    }

    const adOwnerId = (existingAd.user as any)._id ? (existingAd.user as any)._id.toString() : existingAd.user.toString();

    if (adOwnerId !== user.id && user.role !== 'super_admin') {
        return res.status(403).json(formatResponse(false, 'Not authorized to delete this ad'));
    }

    await adService.deleteAd(id);
    res.status(200).json(formatResponse(true, 'Ad deleted successfully'));
});

export const getMyAds = asyncHandler(async (req: Request, res: Response) => {
    const user = req.user as JwtPayload;
    const ads = await adService.getMyAds(user.id);
    res.status(200).json(formatResponse(true, 'My ads fetched successfully', ads));
});
